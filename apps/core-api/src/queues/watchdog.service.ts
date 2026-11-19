import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { ENV, type Env } from '../env.js';
import { caseTracing, MastraClient } from '../mastra-client/mastra-client.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  PROCESS_EMAIL_QUEUE,
  RESUME_WORKFLOW_QUEUE,
  type ProcessEmailJob,
  type ResumeWorkflowJob,
} from './queue-names.js';

/** After this many watchdog restarts, a case is marked failed (relaunchable from the UI). */
export const MAX_RESTARTS = 3;

/**
 * Finds cases that stopped progressing (a Mastra instance died mid-run, a job exhausted its
 * attempts while every instance was down) and gets them going again. Runs every 30 s.
 */
@Injectable()
export class WatchdogService {
  private readonly logger = new Logger(WatchdogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mastra: MastraClient,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(PROCESS_EMAIL_QUEUE) private readonly processEmailQueue: Queue<ProcessEmailJob>,
    @InjectQueue(RESUME_WORKFLOW_QUEUE) private readonly resumeQueue: Queue<ResumeWorkflowJob>,
  ) {}

  async run(now = new Date()): Promise<{ requeued: number; restarted: number; failed: number }> {
    const counts = { requeued: 0, restarted: 0, failed: 0 };
    const stuckBefore = new Date(now.getTime() - this.env.STUCK_CASE_AFTER_MS);

    // Never started (the start job exhausted its attempts, or Core stopped between the claim and
    // the start): queue it again, unless a job for it is still waiting (rate limiter, backlog).
    const pending = new Set(
      (await this.processEmailQueue.getJobs(['waiting', 'delayed', 'active', 'prioritized']))
        .filter(Boolean)
        .map((job) => job.data.caseId),
    );
    const notStarted = await this.prisma.case.findMany({
      where: {
        status: { in: ['received', 'processing'] },
        workflowRunId: null,
        updatedAt: { lt: stuckBefore },
      },
      take: 100,
    });
    for (const kase of notStarted) {
      if (pending.has(kase.id)) continue;
      await this.processEmailQueue.add(
        'process-email',
        { caseId: kase.id },
        { jobId: `${kase.emailId}-w${now.getTime()}` },
      );
      await this.prisma.case.update({
        where: { id: kase.id },
        data: { status: 'received', updatedAt: now },
      });
      counts.requeued += 1;
    }

    const processing = await this.prisma.case.findMany({
      where: { status: 'processing', workflowRunId: { not: null }, updatedAt: { lt: stuckBefore } },
      include: {
        brokerage: true,
        email: true,
        steps: { orderBy: { createdAt: 'desc' }, take: 1 },
        agentEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
        auditLogs: { orderBy: { createdAt: 'asc' } },
        proposedActions: { orderBy: { revision: 'desc' }, take: 1 },
      },
      take: 100,
    });
    for (const kase of processing) {
      const lastActivity = Math.max(
        kase.updatedAt.getTime(),
        kase.steps[0]?.createdAt.getTime() ?? 0,
        kase.agentEvents[0]?.createdAt.getTime() ?? 0,
      );
      if (lastActivity >= stuckBefore.getTime()) continue;
      const restarts = kase.auditLogs.filter((log) => log.action === 'workflow_restarted').length;
      if (restarts >= MAX_RESTARTS) {
        await this.prisma.case.update({
          where: { id: kase.id },
          data: { status: 'failed', failureReason: 'No progress after several restarts.' },
        });
        await this.audit.record({
          caseId: kase.id,
          actor: 'system',
          actorId: 'watchdog',
          action: 'workflow_failed',
          params: { error: 'stuck' },
        });
        this.realtime.publish('case.updated', kase.id, { status: 'failed' }, kase.brokerageId);
        counts.failed += 1;
        continue;
      }
      const tracing = caseTracing(kase.id, {
        brokerCode: kase.brokerage.brokerCode,
        emailLanguage: kase.email.language,
      });
      const decided = kase.proposedActions[0];
      const lastAction = kase.auditLogs.at(-1)?.action;
      try {
        if (decided && decided.status !== 'pending' && lastAction !== 'workflow_resumed') {
          // The decision was taken but the resume never reached Mastra: resume again.
          await this.resumeQueue.add(
            'resume-workflow',
            {
              caseId: kase.id,
              workflowRunId: kase.workflowRunId!,
              decision: {
                approved: decided.status === 'approved',
                brokerId: decided.decidedById ?? 'unknown',
                ...(decided.comment ? { comment: decided.comment } : {}),
              },
            },
            { jobId: `${kase.id}-r${decided.revision}-w${now.getTime()}` },
          );
        } else {
          // The instance running it died: restart from the last snapshot on a live instance.
          await this.mastra.restart(kase.workflowRunId!, tracing);
        }
        await this.prisma.case.update({ where: { id: kase.id }, data: { updatedAt: now } });
        await this.audit.record({
          caseId: kase.id,
          actor: 'system',
          actorId: 'watchdog',
          action: 'workflow_restarted',
          params: { attempt: restarts + 1 },
        });
        counts.restarted += 1;
      } catch (error) {
        this.logger.warn(`restart of case ${kase.id} failed: ${String(error)}`);
      }
    }
    if (counts.requeued + counts.restarted + counts.failed > 0) {
      this.logger.log(`watchdog: ${JSON.stringify(counts)}`);
    }
    return counts;
  }
}
