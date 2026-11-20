import type {
  AgentsActivity,
  BrokerView,
  CaseDetail,
  CaseMetrics,
  CaseStats,
  CaseSummary,
  DecisionRequest,
  HandledRequest,
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
  type DraftReplyJob,
  type ProcessEmailJob,
  type ResumeWorkflowJob,
} from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  caseReference,
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
    @InjectQueue(PROCESS_EMAIL_QUEUE)
    private readonly processEmailQueue: Queue<ProcessEmailJob | DraftReplyJob>,
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
      data: {
        status: 'received',
        workflowRunId: null,
        failureReason: null,
        currentStep: null,
        currentTool: null,
      },
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

  /** V13 live agents panel: cases per running step, the latest one, each agent's model. */
  async agentsActivity(): Promise<AgentsActivity> {
    const [received, processing, awaitingApproval] = await Promise.all([
      this.prisma.case.count({ where: { status: 'received' } }),
      this.prisma.case.groupBy({
        by: ['currentStep'],
        where: { status: 'processing' },
        _count: { _all: true },
      }),
      this.prisma.case.count({ where: { status: 'awaiting_approval' } }),
    ]);
    const running = (step: string | null) =>
      processing.find((group) => group.currentStep === step)?._count._all ?? 0;
    const agents = await Promise.all(
      (['triage', 'coverage', 'service', 'drafting'] as const).map(async (agent) => {
        const [latest, lastStart, lastStep] = await Promise.all([
          this.prisma.case.findFirst({
            where: { status: 'processing', currentStep: agent },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, number: true, currentTool: true },
          }),
          // The model announced when the agent started, else the one of its last finished step.
          this.prisma.agentEvent.findFirst({
            where: { agent, eventType: 'step_started' },
            orderBy: { createdAt: 'desc' },
            select: { params: true },
          }),
          this.prisma.agentStep.findFirst({
            where: { agent, model: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { model: true },
          }),
        ]);
        return {
          agent,
          running: running(agent),
          model:
            (lastStart?.params as Record<string, string> | undefined)?.model ??
            lastStep?.model ??
            null,
          current: latest
            ? {
                caseId: latest.id,
                reference: caseReference(latest.number),
                tool: latest.currentTool,
              }
            : null,
        };
      }),
    );
    return {
      queued: received + running(null),
      awaitingApproval,
      executing: running('execute'),
      agents,
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
      closed: count([
        'classified',
        'claim_filed',
        'ready_to_send',
        'handled_manually',
        'cancellation_filed',
        'merged',
      ]),
      failed: count(['failed']),
      needsBroker: count(['needs_broker']),
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
    const merged = kase.mergedIntoCaseId
      ? await this.prisma.case.findUnique({ where: { id: kase.mergedIntoCaseId } })
      : null;
    return toCaseDetail(kase, {
      knownPolicyStatus: policy?.knownStatus ?? null,
      brokerNames: new Map(brokers.map((broker) => [broker.id, broker.name])),
      mergedInto: merged ? { id: merged.id, reference: caseReference(merged.number) } : null,
    });
  }

  /**
   * The broker approves or rejects a pending proposal (the one given by `actionId`, else the most
   * recent). When a workflow waits for it, the `resume-workflow` worker resumes it; a rejection
   * comment goes back to `draftingAgent`. V15: a standalone reply (follow-up status,
   * acknowledgement) is just made ready to send, or re-drafted after a rejection.
   */
  async decide(caseId: string, request: DecisionRequest): Promise<void> {
    const broker = await this.currentBroker();
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        proposedActions: { where: { status: 'pending' }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    const action = request.actionId
      ? kase.proposedActions.find((candidate) => candidate.id === request.actionId)
      : kase.proposedActions[0];
    if (!action || (action.awaitsWorkflow && kase.status !== 'awaiting_approval')) {
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
          // A standalone reply is sent as approved.
          ...(!action.awaitsWorkflow && request.approved
            ? { finalDraftSubject: action.draftSubject, finalDraftBody: action.draftBody }
            : {}),
        },
      });
      if (updated.count === 0) return false;
      if (action.awaitsWorkflow) {
        await tx.case.update({
          where: { id: caseId },
          data: { status: 'processing', currentStep: null, currentTool: null },
        });
      }
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
          },
        },
        tx,
      );
      if (!action.awaitsWorkflow && request.approved) {
        await this.audit.record(
          {
            caseId,
            actor: 'system',
            actorId: 'system',
            action: 'reply_ready',
            params: { actionType: action.actionType },
          },
          tx,
        );
      }
      return true;
    });
    if (!decided) throw new ConflictException('This proposal was already decided.');

    if (!action.awaitsWorkflow) {
      if (!request.approved) {
        // Re-drafted by the `draft-reply` workflow with the broker's comment.
        const email = await this.replyTarget(kase.id, kase.emailId, action.actionType);
        await this.processEmailQueue.add(
          'draft-reply',
          {
            caseId,
            kind: action.actionType === 'send_status' ? 'send_status' : 'acknowledge',
            emailId: email,
            previous: {
              subject: action.draftSubject,
              body: action.draftBody,
              comment: request.comment ?? null,
            },
          },
          { jobId: `reply-${action.id}` },
        );
      }
      this.realtime.publish('case.updated', caseId, { reply: true }, kase.brokerageId);
      return;
    }
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
      { jobId: `${caseId}-${action.id}` },
    );
    this.realtime.publish('case.updated', caseId, { status: 'processing' }, kase.brokerageId);
  }

  /** The e-mail a standalone reply answers: the latest follow-up, else the case's e-mail. */
  private async replyTarget(caseId: string, emailId: string, actionType: string): Promise<string> {
    if (actionType !== 'send_status') return emailId;
    const latest = await this.prisma.inboundEmail.findFirst({
      where: { followUpOfCaseId: caseId },
      orderBy: { receivedAt: 'desc' },
    });
    return latest?.id ?? emailId;
  }

  /**
   * V15 "Marquer comme traité": the broker handled the case outside the demo (a certificate, a
   * quote, a case the agents could not finish). Pending replies are left as they are.
   */
  async markHandled(caseId: string, request: HandledRequest): Promise<void> {
    const broker = await this.currentBroker();
    const kase = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    if (!['needs_broker', 'failed'].includes(kase.status)) {
      throw new ConflictException('Only a case left to the broker can be marked as handled.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: caseId }, data: { status: 'handled_manually' } });
      await this.audit.record(
        {
          caseId,
          actor: 'broker',
          actorId: broker.id,
          action: 'case_handled_manually',
          params: request.comment ? { comment: request.comment } : {},
        },
        tx,
      );
    });
    this.realtime.publish('case.closed', caseId, { outcome: 'handled_manually' }, kase.brokerageId);
  }

  /**
   * V15: documents arrived in a follow-up — the case is analysed again from the start with every
   * attachment (a new workflow run). A proposal still pending on the old run is withdrawn.
   */
  async reanalyze(caseId: string): Promise<void> {
    const broker = await this.currentBroker();
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { _count: { select: { followUps: true } } },
    });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    if (kase._count.followUps === 0 || ['received', 'processing'].includes(kase.status)) {
      throw new ConflictException(
        'Only a case with a follow-up, not running, can be analysed again.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.proposedAction.updateMany({
        where: { caseId, status: 'pending', awaitsWorkflow: true },
        data: {
          status: 'rejected',
          comment: 'superseded by a new analysis',
          decidedAt: new Date(),
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: 'received',
          workflowRunId: null,
          failureReason: null,
          handoverReason: null,
          currentStep: null,
          currentTool: null,
        },
      });
      await this.audit.record(
        { caseId, actor: 'broker', actorId: broker.id, action: 'analysis_restarted', params: {} },
        tx,
      );
    });
    await this.processEmailQueue.add(
      'process-email',
      { caseId },
      { jobId: `${kase.emailId}-reanalyze-${Date.now()}` },
    );
    this.realtime.publish('case.updated', caseId, { status: 'received' }, kase.brokerageId);
  }

  /** The file of an attachment (V14), served inline so the UI can open the PDF. */
  async attachmentFile(
    caseId: string,
    attachmentId: string,
  ): Promise<{ fileName: string; type: string; content: Uint8Array }> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        // The case's e-mail, or one of its follow-ups (V15).
        OR: [{ email: { case: { id: caseId } } }, { email: { followUpOfCaseId: caseId } }],
      },
      select: { fileName: true, type: true, content: true },
    });
    if (!attachment || attachment.content.length === 0) {
      throw new NotFoundException('This attachment has no file (unknown, or purged).');
    }
    return attachment;
  }
}
