import type { BrokerView, CaseDetail, CaseStats, CaseSummary, DecisionRequest } from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESUME_WORKFLOW_QUEUE, type ResumeWorkflowJob } from '../queues/queue-names.js';
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
  ) {}

  async listBrokers(): Promise<BrokerView[]> {
    const brokers = await this.prisma.broker.findMany({
      include: { brokerage: true },
      orderBy: [{ brokerage: { name: 'asc' } }, { name: 'asc' }],
    });
    return brokers.map((broker) => ({
      id: broker.id,
      name: broker.name,
      email: broker.email,
      preferredLocale: broker.preferredLocale,
      brokerage: {
        id: broker.brokerage.id,
        name: broker.brokerage.name,
        brokerCode: broker.brokerage.brokerCode,
      },
    }));
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
    const groups = await this.prisma.case.groupBy({ by: ['status'], _count: { _all: true } });
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
   * `resume-workflow` worker; a rejection comment goes back to `draftingAgent`.
   */
  async decide(caseId: string, brokerId: string, request: DecisionRequest): Promise<void> {
    const broker = await this.prisma.broker.findUnique({ where: { id: brokerId } });
    if (!broker) throw new UnauthorizedException(`Unknown broker ${brokerId}.`);
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { proposedActions: { where: { status: 'pending' }, orderBy: { revision: 'desc' } } },
    });
    if (!kase) throw new NotFoundException(`No case ${caseId}.`);
    if (kase.brokerageId !== broker.brokerageId) {
      throw new ForbiddenException('This case belongs to another brokerage.');
    }
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
    this.realtime.publish('case.updated', caseId, { status: 'processing' });
  }
}
