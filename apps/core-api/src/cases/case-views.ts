import type {
  AgentEventView,
  AgentStepView,
  AuditLogView,
  CaseDetail,
  CaseStage,
  CaseSummary,
  ProposedActionView,
} from '@demo/shared';
import type { Prisma } from '../generated/prisma/client.js';

export function caseReference(number: number): string {
  return `CASE-${String(number).padStart(4, '0')}`;
}

export const caseSummaryInclude = {
  brokerage: true,
  client: true,
  email: true,
  _count: { select: { proposedActions: true } },
} satisfies Prisma.CaseInclude;

export const caseDetailInclude = {
  brokerage: true,
  client: true,
  email: { include: { attachments: { orderBy: { position: 'asc' } } } },
  steps: { orderBy: { createdAt: 'asc' } },
  agentEvents: { orderBy: { createdAt: 'asc' } },
  proposedActions: { orderBy: { revision: 'asc' } },
  auditLogs: { orderBy: { createdAt: 'asc' } },
  _count: { select: { proposedActions: true } },
} satisfies Prisma.CaseInclude;

type CaseWithSummary = Prisma.CaseGetPayload<{ include: typeof caseSummaryInclude }>;
type CaseWithDetail = Prisma.CaseGetPayload<{ include: typeof caseDetailInclude }>;

const WORK_STEPS = new Set<string>(['triage', 'coverage', 'drafting', 'execute']);

/** V13 live stage, from the status and the step announced by the last `step_started` event. */
export function caseStage(kase: { status: string; currentStep: string | null }): CaseStage {
  switch (kase.status) {
    case 'received':
      return 'queued';
    case 'processing':
      return kase.currentStep && WORK_STEPS.has(kase.currentStep)
        ? (kase.currentStep as CaseStage)
        : 'queued';
    case 'awaiting_approval':
      return 'awaiting_approval';
    case 'failed':
      return 'failed';
    default:
      return 'done';
  }
}

export function toCaseSummary(kase: CaseWithSummary): CaseSummary {
  return {
    id: kase.id,
    reference: caseReference(kase.number),
    status: kase.status,
    brokerageName: kase.brokerage.name,
    clientName: kase.client?.companyName ?? null,
    from: kase.email.from,
    subject: kase.email.subject,
    language: kase.email.language,
    requestType: kase.requestType,
    verdict: (kase.verdict as CaseSummary['verdict']) ?? null,
    alerts: kase.alerts as CaseSummary['alerts'],
    receivedAt: kase.email.receivedAt.toISOString(),
    updatedAt: kase.updatedAt.toISOString(),
    stage: caseStage(kase),
    currentTool: kase.status === 'processing' ? kase.currentTool : null,
    revision: kase._count.proposedActions,
  };
}

export function toCaseDetail(
  kase: CaseWithDetail,
  extra: {
    knownPolicyStatus: CaseDetail['knownPolicyStatus'];
    brokerNames: Map<string, string>;
  },
): CaseDetail {
  const steps: AgentStepView[] = kase.steps.map((step) => ({
    id: step.id,
    agent: step.agent as AgentStepView['agent'],
    stepType: step.stepType as AgentStepView['stepType'],
    params: step.params as AgentStepView['params'],
    sources: step.sources as AgentStepView['sources'],
    model: step.model,
    durationMs: step.durationMs,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    costUsd: step.costUsd,
    createdAt: step.createdAt.toISOString(),
  }));
  const agentEvents: AgentEventView[] = kase.agentEvents.map((event) => ({
    id: event.id,
    agent: event.agent as AgentEventView['agent'],
    eventType: event.eventType as AgentEventView['eventType'],
    params: event.params as AgentEventView['params'],
    createdAt: event.createdAt.toISOString(),
  }));
  const proposedActions: ProposedActionView[] = kase.proposedActions.map((action) => ({
    id: action.id,
    revision: action.revision,
    actionType: action.actionType,
    draftSubject: action.draftSubject,
    draftBody: action.draftBody,
    draftLanguage: action.draftLanguage,
    internalNote: action.internalNote,
    noteLanguage: action.noteLanguage,
    claimFiling: (action.claimFiling as ProposedActionView['claimFiling']) ?? null,
    status: action.status,
    decidedBy: action.decidedById
      ? {
          id: action.decidedById,
          name: extra.brokerNames.get(action.decidedById) ?? action.decidedById,
        }
      : null,
    comment: action.comment,
    decidedAt: action.decidedAt?.toISOString() ?? null,
    createdAt: action.createdAt.toISOString(),
  }));
  const auditLogs: AuditLogView[] = kase.auditLogs.map((log) => ({
    id: log.id,
    actor: log.actor,
    actorId: log.actorId,
    actorName: log.actor === 'broker' ? (extra.brokerNames.get(log.actorId) ?? null) : null,
    action: log.action as AuditLogView['action'],
    params: log.params as AuditLogView['params'],
    source: log.source,
    createdAt: log.createdAt.toISOString(),
  }));
  return {
    ...toCaseSummary(kase),
    brokerage: {
      id: kase.brokerage.id,
      name: kase.brokerage.name,
      brokerCode: kase.brokerage.brokerCode,
      locale: kase.brokerage.locale,
    },
    client: kase.client ? { id: kase.client.id, companyName: kase.client.companyName } : null,
    policyNumber: kase.policyNumber,
    knownPolicyStatus: extra.knownPolicyStatus,
    claimNumber: kase.claimNumber,
    failureReason: kase.failureReason,
    workflowRunId: kase.workflowRunId,
    traceId: kase.traceId,
    email: {
      from: kase.email.from,
      to: kase.email.to,
      subject: kase.email.subject,
      body: kase.email.body,
      receivedAt: kase.email.receivedAt.toISOString(),
      language: kase.email.language,
      attachments: kase.email.attachments.map(({ fileName, type, extractedText }) => ({
        fileName,
        type,
        extractedText,
      })),
    },
    steps,
    agentEvents,
    proposedActions,
    auditLogs,
  };
}
