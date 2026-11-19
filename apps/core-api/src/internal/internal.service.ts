import type {
  AgentEventCallback,
  AgentStepCallback,
  ClientLookupQuery,
  ClientLookupResult,
  ExecutedActionCallback,
  ProposedActionCallback,
  WorkflowFailedCallback,
} from '@demo/shared';
import { AgentStepCallbackSchema } from '@demo/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
    if (step.stepType === 'coverage.policy_checked' && typeof params.policyNumber === 'string') {
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
      data: { caseId, agent: event.agent, eventType: event.eventType, params: event.params },
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
    input: ProposedActionCallback,
  ): Promise<CallbackOutcome> {
    const brokerageId = await this.brokerageOf(caseId);
    if (!brokerageId) return IGNORED;
    const { action } = input;
    // Idempotent: a retried callback for the same revision changes nothing (no second audit row,
    // no status rollback if the broker already decided).
    const existing = await this.prisma.proposedAction.findUnique({
      where: { caseId_revision: { caseId, revision: action.revision } },
    });
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
      };
      // Idempotent: a retried callback for the same revision does not duplicate the proposal.
      await tx.proposedAction.upsert({
        where: { caseId_revision: { caseId, revision: action.revision } },
        create: { caseId, revision: action.revision, ...data },
        update: {},
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: 'awaiting_approval',
          workflowRunId: input.workflowRunId,
          verdict: input.verdict,
          alerts: input.alerts,
        },
      });
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
    await this.prisma.$transaction(async (tx) => {
      if (result.outcome === 'classified') {
        await tx.case.update({
          where: { id: caseId },
          data: { status: 'classified', requestType: result.requestType },
        });
        await this.audit.record(
          {
            caseId,
            actor: 'system',
            actorId: 'system',
            action: 'case_classified',
            params: { requestType: result.requestType },
          },
          tx,
        );
        return;
      }
      const status = result.outcome === 'claim_filed' ? 'claim_filed' : 'ready_to_send';
      await tx.case.update({
        where: { id: caseId },
        data: {
          status,
          claimNumber: result.outcome === 'claim_filed' ? result.claimNumber : null,
        },
      });
      await this.audit.record(
        {
          caseId,
          actor: 'system',
          actorId: 'system',
          action: status,
          params: {
            actionType: result.action.actionType,
            revision: result.action.revision,
            approvedBy: result.approvedBy,
            ...(result.outcome === 'claim_filed' ? { claimNumber: result.claimNumber } : {}),
          },
          source: result.outcome === 'claim_filed' ? 'mcp:file_claim' : null,
        },
        tx,
      );
    });
    this.realtime.publish('case.closed', caseId, { outcome: result.outcome }, brokerageId);
    return { status: 'recorded' };
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
}
