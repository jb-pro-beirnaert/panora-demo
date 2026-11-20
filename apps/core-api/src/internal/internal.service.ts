import type {
  AgentEventCallback,
  AgentStepCallback,
  ClientCase,
  ClientCasesQuery,
  ClientLookupQuery,
  ClientLookupResult,
  ExecutedActionCallback,
  ProposedActionCallback,
  WorkflowFailedCallback,
} from '@demo/shared';
import { AgentStepCallbackSchema, ProposedActionCallbackSchema } from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { caseReference } from '../cases/case-views.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PROCESS_EMAIL_QUEUE, type DraftReplyJob } from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';

export type CallbackOutcome = { status: 'recorded' } | { status: 'ignored'; reason: string };

const IGNORED: CallbackOutcome = { status: 'ignored', reason: 'unknown case (reset?)' };

/** Mastra → Core callbacks. A callback for a case that no longer exists (after a reset) is ignored. */
/** `read_clause CG-HZ-12.1`: the tool and its most telling argument. */
function toolLabel(params: Record<string, string>): string {
  const { tool, ...args } = params;
  const argument = Object.values(args)[0];
  return argument ? `${tool} ${argument}` : String(tool);
}

@Injectable()
export class InternalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @InjectQueue(PROCESS_EMAIL_QUEUE) private readonly processEmailQueue: Queue<DraftReplyJob>,
  ) {}

  /** The case's brokerage, or null when the case no longer exists. */
  private async brokerageOf(caseId: string): Promise<string | null> {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { brokerageId: true },
    });
    return kase?.brokerageId ?? null;
  }

  async recordStep(caseId: string, input: AgentStepCallback): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const step = AgentStepCallbackSchema.parse(input);
    const params = { ...step.params };

    // The brokerage's belief next to the insurer's answer: the flagship mismatch (scenario 2).
    if (
      (step.stepType === 'coverage.policy_checked' || step.stepType === 'service.policy_checked') &&
      typeof params.policyNumber === 'string'
    ) {
      const policy = await this.prisma.policy.findUnique({
        where: { number: params.policyNumber },
      });
      params.knownStatus = policy?.knownStatus ?? null;
    }

    const caseUpdate: Prisma.CaseUpdateInput = {};
    if (step.stepType === 'triage.completed') {
      if (typeof params.requestType === 'string') caseUpdate.requestType = params.requestType;
      if (typeof params.policyNumber === 'string') caseUpdate.policyNumber = params.policyNumber;
    }
    if (step.stepType === 'triage.client_found' && typeof params.clientId === 'string') {
      caseUpdate.client = { connect: { id: params.clientId } };
    }
    if (step.stepType === 'service.analysis' && typeof params.policyNumber === 'string') {
      caseUpdate.policyNumber = params.policyNumber;
      if (Array.isArray(params.alerts)) caseUpdate.alerts = params.alerts;
    }
    if (step.stepType === 'coverage.verdict') {
      if (typeof params.verdict === 'string') caseUpdate.verdict = params.verdict;
      if (Array.isArray(params.alerts)) caseUpdate.alerts = params.alerts;
      if (typeof params.policyNumber === 'string') caseUpdate.policyNumber = params.policyNumber;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.agentStep.create({
        data: {
          caseId,
          agent: step.agent,
          stepType: step.stepType,
          params,
          sources: step.sources,
          model: step.model,
          durationMs: step.durationMs,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          costUsd: step.costUsd,
        },
      });
      if (Object.keys(caseUpdate).length > 0) {
        await tx.case.update({ where: { id: caseId }, data: caseUpdate });
      }
      await this.audit.record(
        {
          caseId,
          actor: step.agent === 'system' ? 'system' : 'agent',
          actorId: step.agent,
          action: 'agent_step',
          params: { stepType: step.stepType, ...params },
          source: step.sources.map((source) => source.ref).join(', ') || null,
        },
        tx,
      );
      return row;
    });
    this.realtime.publish(
      'case.step',
      caseId,
      { stepId: created.id, stepType: step.stepType },
      brokerageId,
    );
    return { status: 'recorded' };
  }

  /** A tool call while an agent works: live timeline only (the audit keeps business steps). */
  async recordAgentEvent(caseId: string, event: AgentEventCallback): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const row = await this.prisma.agentEvent.create({
      data: {
        caseId,
        agent: event.agent,
        eventType: event.eventType,
        params: event.params,
        ...(event.result !== undefined ? { result: event.result as Prisma.InputJsonValue } : {}),
      },
    });
    // V13 live stage: the step running now and the tool its agent called last.
    if (event.eventType === 'step_started' && event.params.step) {
      await this.prisma.case.updateMany({
        where: { id: caseId },
        data: { currentStep: event.params.step, currentTool: null },
      });
    } else if (event.eventType === 'tool_call' && event.params.tool) {
      await this.prisma.case.updateMany({
        where: { id: caseId },
        data: { currentTool: toolLabel(event.params) },
      });
    }
    this.realtime.publish(
      'case.agent_event',
      caseId,
      {
        eventId: row.id,
        agent: event.agent,
        eventType: event.eventType,
        params: event.params,
      },
      brokerageId,
    );
    return { status: 'recorded' };
  }

  async recordProposedAction(
    caseId: string,
    payload: ProposedActionCallback,
  ): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const input = ProposedActionCallbackSchema.parse(payload);
    const { action } = input;
    const key = {
      caseId_workflowRunId_revision: {
        caseId,
        workflowRunId: input.workflowRunId,
        revision: action.revision,
      },
    };
    // Idempotent: a retried callback for the same run and revision changes nothing (no second
    // audit row, no status rollback if the broker already decided).
    const existing = await this.prisma.proposedAction.findUnique({ where: key });
    if (existing) return { status: 'recorded' };
    await this.prisma.$transaction(async (tx) => {
      const data = {
        workflowRunId: input.workflowRunId,
        actionType: action.actionType,
        draftSubject: action.clientEmailDraft.subject,
        draftBody: action.clientEmailDraft.body,
        draftLanguage: input.draftLanguage,
        internalNote: action.internalNote,
        noteLanguage: input.noteLanguage,
        claimFiling: (action.claimFiling ?? undefined) as Prisma.InputJsonValue | undefined,
        cancellation: (action.cancellation ?? undefined) as Prisma.InputJsonValue | undefined,
        awaitsWorkflow: input.awaitsWorkflow,
      };
      await tx.proposedAction.upsert({
        where: key,
        create: { caseId, revision: action.revision, ...data },
        update: {},
      });
      // A standalone reply (V15) leaves the case's status alone: no workflow waits for it.
      if (input.awaitsWorkflow) {
        await tx.case.update({
          where: { id: caseId },
          data: {
            status: 'awaiting_approval',
            workflowRunId: input.workflowRunId,
            ...(input.verdict ? { verdict: input.verdict } : {}),
            alerts: input.alerts,
          },
        });
      }
      await this.audit.record(
        {
          caseId,
          actor: 'agent',
          actorId: 'drafting',
          action: 'action_proposed',
          params: { revision: action.revision, actionType: action.actionType },
        },
        tx,
      );
    });
    this.realtime.publish(
      'case.action_proposed',
      caseId,
      {
        revision: action.revision,
        actionType: action.actionType,
      },
      brokerageId,
    );
    return { status: 'recorded' };
  }

  async recordExecutedAction(
    caseId: string,
    input: ExecutedActionCallback,
  ): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const { result } = input;
    const system = { actor: 'system' as const, actorId: 'system' };
    let followUp: DraftReplyJob | null = null;
    await this.prisma.$transaction(async (tx) => {
      switch (result.outcome) {
        case 'classified':
          await tx.case.update({
            where: { id: caseId },
            data: { status: 'classified', requestType: result.requestType },
          });
          await this.audit.record(
            {
              caseId,
              ...system,
              action: 'case_classified',
              params: { requestType: result.requestType, subtype: result.subtype },
            },
            tx,
          );
          return;
        case 'handover':
          await tx.case.update({
            where: { id: caseId },
            data: { status: 'needs_broker', handoverReason: result.reason },
          });
          await this.audit.record(
            { caseId, ...system, action: 'handed_over', params: { reason: result.reason } },
            tx,
          );
          return;
        case 'merged': {
          // A follow-up without In-Reply-To: its e-mail joins the case it refers to, which gets a
          // status reply; this case is closed as merged.
          const source = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
          const target = await tx.case.findUnique({ where: { id: result.targetCaseId } });
          if (!target) return;
          await tx.inboundEmail.update({
            where: { id: source.emailId },
            data: { followUpOfCaseId: target.id },
          });
          await tx.case.update({
            where: { id: caseId },
            data: { status: 'merged', mergedIntoCaseId: target.id, requestType: 'follow_up' },
          });
          await this.audit.record(
            {
              caseId,
              ...system,
              action: 'follow_up_merged',
              params: { into: caseReference(target.number) },
            },
            tx,
          );
          await this.audit.record(
            {
              caseId: target.id,
              ...system,
              action: 'follow_up_received',
              params: { from: caseReference(source.number) },
            },
            tx,
          );
          followUp = { caseId: target.id, kind: 'send_status', emailId: source.emailId };
          return;
        }
      }
      const status =
        result.outcome === 'claim_filed'
          ? 'claim_filed'
          : result.outcome === 'cancellation_filed'
            ? 'cancellation_filed'
            : 'ready_to_send';
      await tx.case.update({
        where: { id: caseId },
        data: {
          status,
          claimNumber: result.outcome === 'claim_filed' ? result.claimNumber : null,
        },
      });
      // V15: the reply as it will be sent, on the approved proposal.
      if (result.finalDraft) {
        await tx.proposedAction.updateMany({
          where: {
            caseId,
            workflowRunId: input.workflowRunId,
            revision: result.action.revision,
          },
          data: {
            finalDraftSubject: result.finalDraft.subject,
            finalDraftBody: result.finalDraft.body,
          },
        });
      }
      if (result.outcome === 'cancellation_filed' && result.action.cancellation) {
        await tx.policy.updateMany({
          where: { number: result.action.cancellation.policyNumber },
          data: { cancellationEffectiveDate: new Date(`${result.effectiveDate}T00:00:00Z`) },
        });
      }
      await this.audit.record(
        {
          caseId,
          ...system,
          action: status,
          params: {
            actionType: result.action.actionType,
            revision: result.action.revision,
            approvedBy: result.approvedBy,
            ...(result.outcome === 'claim_filed' ? { claimNumber: result.claimNumber } : {}),
            ...(result.outcome === 'cancellation_filed'
              ? { effectiveDate: result.effectiveDate }
              : {}),
          },
          source:
            result.outcome === 'claim_filed'
              ? 'mcp:file_claim'
              : result.outcome === 'cancellation_filed'
                ? 'mcp:request_cancellation'
                : null,
        },
        tx,
      );
    });
    if (followUp) await this.enqueueReply(followUp);
    this.realtime.publish('case.closed', caseId, { outcome: result.outcome }, brokerageId);
    return { status: 'recorded' };
  }

  /** V15: a standalone reply drafted by the `draft-reply` workflow. */
  async enqueueReply(job: DraftReplyJob): Promise<void> {
    await this.processEmailQueue.add('draft-reply', job, {
      jobId: `reply-${job.caseId}-${job.emailId}-${Date.now()}`,
    });
  }

  async recordFailure(caseId: string, input: WorkflowFailedCallback): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const reason = input.error.slice(0, 1_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({
        where: { id: caseId },
        data: { status: 'failed', failureReason: reason },
      });
      await this.audit.record(
        {
          caseId,
          actor: 'system',
          actorId: 'system',
          action: 'workflow_failed',
          params: { error: reason },
        },
        tx,
      );
    });
    this.realtime.publish('case.updated', caseId, { status: 'failed' }, brokerageId);
    return { status: 'recorded' };
  }

  /** `find_client`: the brokerage's client behind a sender address, with their policies. */
  async findClient(query: ClientLookupQuery): Promise<ClientLookupResult> {
    const client = await this.prisma.client.findFirst({
      where: {
        email: { equals: query.email, mode: 'insensitive' },
        brokerage: { brokerCode: query.brokerCode },
      },
      include: { policies: { orderBy: { number: 'asc' } } },
    });
    if (!client) {
      throw new NotFoundException(
        `No client of this brokerage uses the address ${query.email}. The sender may be a new or unknown client: use the holder name written in the e-mail, if any, with search_policy.`,
      );
    }
    return {
      client: {
        id: client.id,
        companyName: client.companyName,
        siren: client.siren,
        contactName: client.contactName,
      },
      policies: client.policies.map((policy) => ({
        number: policy.number,
        insurerName: policy.insurerName,
        product: policy.product,
        knownStatus: policy.knownStatus,
      })),
    };
  }

  /**
   * `find_client_cases` (V15): the brokerage's recent cases for a sender address, newest first —
   * to spot a claim sent twice, or the case a follow-up refers to.
   */
  async findClientCases(query: ClientCasesQuery): Promise<ClientCase[]> {
    const cases = await this.prisma.case.findMany({
      where: {
        email: { from: { equals: query.email, mode: 'insensitive' } },
        ...(query.excludeCaseId ? { id: { not: query.excludeCaseId } } : {}),
        status: { not: 'merged' },
      },
      include: {
        email: true,
        steps: { where: { stepType: 'triage.completed' }, take: 1 },
        proposedActions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return cases.map((kase) => {
      const triage = (kase.steps[0]?.params ?? {}) as Record<string, unknown>;
      const last = kase.proposedActions[0];
      return {
        caseId: kase.id,
        reference: caseReference(kase.number),
        receivedAt: kase.email.receivedAt.toISOString(),
        subject: kase.email.subject,
        requestType: kase.requestType,
        status: kase.status,
        policyNumber: kase.policyNumber,
        incidentDate: typeof triage.incidentDate === 'string' ? triage.incidentDate : null,
        nature: typeof triage.nature === 'string' ? triage.nature : null,
        amount: typeof triage.amount === 'number' ? triage.amount : null,
        claimNumber: kase.claimNumber,
        lastAction: last ? { actionType: last.actionType, status: last.status } : null,
      };
    });
  }
}
