import type {
  BrokerView,
  CaseDetail,
  CaseMetrics,
  CaseStats,
  CaseSummary,
  DecisionRequest,
} from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PROCESS_EMAIL_QUEUE,
  RESUME_WORKFLOW_QUEUE,
  type ProcessEmailJob,
  type ResumeWorkflowJob,
} from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  caseDetailInclude,
  caseSummaryInclude,
  toCaseDetail,
  toCaseSummary,
} from './case-views.js';

const LIST_LIMIT = 200;

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @InjectQueue(RESUME_WORKFLOW_QUEUE) private readonly resumeQueue: Queue<ResumeWorkflowJob>,
    @InjectQueue(PROCESS_EMAIL_QUEUE) private readonly processEmailQueue: Queue<ProcessEmailJob>,
  ) {}

  /** Load metrics (V9): status counts, throughput, durations, queue depths. */
  async metrics(now = new Date()): Promise<CaseMetrics> {
    const groups = await this.prisma.case.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    const closedStatuses = ['classified', 'claim_filed', 'ready_to_send'] as const;
    const closedLastMinute = await this.prisma.case.count({
      where: {
        status: { in: [...closedStatuses] },
        updatedAt: { gte: new Date(now.getTime() - 60_000) },
      },
    });
    const closed = await this.prisma.case.findMany({
      where: { status: { in: [...closedStatuses] } },
      select: { createdAt: true, updatedAt: true },
    });
    const durations = closed
      .map((c) => c.updatedAt.getTime() - c.createdAt.getTime())
      .sort((a, b) => a - b);
    const at = (p: number) =>
      durations[Math.min(durations.length - 1, Math.floor(p * durations.length))]!;
    const queues: CaseMetrics['queues'] = {};
    for (const queue of [this.processEmailQueue, this.resumeQueue]) {
      const c = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      queues[queue.name] = {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
      };
    }
    const restarts = await this.prisma.auditLog.count({
      where: { action: { in: ['workflow_restarted', 'workflow_retried'] } },
    });
    return {
      total: groups.reduce((sum, g) => sum + g._count._all, 0),
      byStatus,
      closedLastMinute,
      durationMs: durations.length ? { p50: at(0.5), p95: at(0.95) } : null,
      queues,
      restarts,
    };
  }

  /** A failed case is relaunched from the start (a new workflow run; the history is kept). */
  async retry(caseId: string): Promise<void> {
    const broker = await this.currentBroker();
    const kase = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    if (kase.status !== 'failed') {
      throw new ConflictException('Only a failed case can be relaunched.');
    }
    await this.prisma.case.update({
      where: { id: caseId },
      data: { status: 'received', workflowRunId: null, failureReason: null },
    });
    await this.audit.record({
      caseId,
      actor: 'broker',
      actorId: broker.id,
      action: 'workflow_retried',
      params: {},
    });
    await this.processEmailQueue.add(
      'process-email',
      { caseId },
      { jobId: `${kase.emailId}-retry-${Date.now()}` },
    );
    this.realtime.publish('case.updated', caseId, { status: 'received' }, kase.brokerageId);
  }

  /**
   * The demo's only broker (V12): the implicit user of the UI and author of every decision. The
   * databases are empty until the simulator seeds them, right after startup or a reset.
   */
  async currentBroker(): Promise<BrokerView> {
    const broker = await this.prisma.broker.findFirst({
      include: { brokerage: true },
      orderBy: { id: 'asc' },
    });
    if (!broker) {
      throw new ServiceUnavailableException('No broker yet: the simulator seeds the demo data.');
    }
    return {
      id: broker.id,
      name: broker.name,
      email: broker.email,
      preferredLocale: broker.preferredLocale,
      brokerage: {
        id: broker.brokerage.id,
        name: broker.brokerage.name,
        brokerCode: broker.brokerage.brokerCode,
      },
    };
  }

  async list(): Promise<CaseSummary[]> {
    const cases = await this.prisma.case.findMany({
      include: caseSummaryInclude,
      orderBy: { number: 'desc' },
      take: LIST_LIMIT,
    });
    return cases.map(toCaseSummary);
  }

  async stats(): Promise<CaseStats> {
    const groups = await this.prisma.case.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const count = (statuses: string[]) =>
      groups
        .filter((group) => statuses.includes(group.status))
        .reduce((sum, group) => sum + group._count._all, 0);
    return {
      total: count(groups.map((group) => group.status)),
      inProgress: count(['received', 'processing']),
      awaitingApproval: count(['awaiting_approval']),
      closed: count(['classified', 'claim_filed', 'ready_to_send']),
      failed: count(['failed']),
    };
  }

  async detail(caseId: string): Promise<CaseDetail> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: caseDetailInclude,
    });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    const policy = kase.policyNumber
      ? await this.prisma.policy.findUnique({ where: { number: kase.policyNumber } })
      : null;
    const brokerIds = [
      ...kase.auditLogs.filter((log) => log.actor === 'broker').map((log) => log.actorId),
      ...kase.proposedActions.flatMap((action) => (action.decidedById ? [action.decidedById] : [])),
    ];
    const brokers = await this.prisma.broker.findMany({ where: { id: { in: brokerIds } } });
    return toCaseDetail(kase, {
      knownPolicyStatus: policy?.knownStatus ?? null,
      brokerNames: new Map(brokers.map((broker) => [broker.id, broker.name])),
    });
  }

  /**
   * The broker approves or rejects the pending proposal. The workflow is resumed by the
   * `resume-workflow` worker; a rejection comment goes back to `draftingAgent`. `auto`: decided
   * by the simulated broker (auto-validation), shown as such in the audit.
   */
  async decide(
    caseId: string,
    request: DecisionRequest,
    { auto = false }: { auto?: boolean } = {},
  ): Promise<void> {
    const broker = await this.currentBroker();
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { proposedActions: { where: { status: 'pending' }, orderBy: { revision: 'desc' } } },
    });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    const action = kase.proposedActions[0];
    if (kase.status !== 'awaiting_approval' || !action) {
      throw new ConflictException('This case has no proposal awaiting a decision.');
    }

    // Conditional update: two concurrent decisions cannot both win.
    const decided = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.proposedAction.updateMany({
        where: { id: action.id, status: 'pending' },
        data: {
          status: request.approved ? 'approved' : 'rejected',
          decidedById: broker.id,
          comment: request.comment ?? null,
          decidedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;
      await tx.case.update({ where: { id: caseId }, data: { status: 'processing' } });
      await this.audit.record(
        {
          caseId,
          actor: 'broker',
          actorId: broker.id,
          action: request.approved ? 'action_approved' : 'action_rejected',
          params: {
            revision: action.revision,
            actionType: action.actionType,
            ...(request.comment ? { comment: request.comment } : {}),
            ...(auto ? { auto: true } : {}),
          },
        },
        tx,
      );
      return true;
    });
    if (!decided) throw new ConflictException('This proposal was already decided.');

    await this.resumeQueue.add(
      'resume-workflow',
      {
        caseId,
        workflowRunId: action.workflowRunId,
        decision: {
          approved: request.approved,
          brokerId: broker.id,
          ...(request.comment ? { comment: request.comment } : {}),
        },
      },
      { jobId: `${caseId}-r${action.revision}` },
    );
    this.realtime.publish('case.updated', caseId, { status: 'processing' }, kase.brokerageId);
  }
}
