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
  _count: {
    select: {
      proposedActions: true,
      followUps: true,
    },
  },
  // V15: replies waiting for the broker (a follow-up reply can wait on a closed case).
  proposedActions: { where: { status: 'pending' }, select: { id: true } },
} satisfies Prisma.CaseInclude;

export const caseDetailInclude = {
  brokerage: true,
  client: true,
  email: { include: { attachments: { orderBy: { position: 'asc' }, omit: { content: true } } } },
  steps: { orderBy: { createdAt: 'asc' } },
  agentEvents: { orderBy: { createdAt: 'asc' } },
  proposedActions: { orderBy: { createdAt: 'asc' } },
  auditLogs: { orderBy: { createdAt: 'asc' } },
  followUps: {
    orderBy: { receivedAt: 'asc' },
    include: { attachments: { orderBy: { position: 'asc' }, omit: { content: true } } },
  },
  _count: { select: { proposedActions: true, followUps: true } },
} satisfies Prisma.CaseInclude;

type CaseWithSummary = Prisma.CaseGetPayload<{ include: typeof caseSummaryInclude }>;
type CaseWithDetail = Prisma.CaseGetPayload<{ include: typeof caseDetailInclude }>;

const WORK_STEPS = new Set<string>(['triage', 'coverage', 'drafting', 'execute']);

/**
 * V13 live stage, from the status and the step announced by the last `step_started` event. V15:
 * the policy service agent shows as the analysis step; a reply waiting for the broker (follow-up,
 * acknowledgement) puts the case back in "to approve"; "À traiter par vous" is its own stage.
 */
export function caseStage(kase: {
  status: string;
  currentStep: string | null;
  pendingProposals?: number;
}): CaseStage {
  if (kase.status === 'processing') {
    const step = kase.currentStep === 'service' ? 'coverage' : kase.currentStep;
    return step && WORK_STEPS.has(step) ? (step as CaseStage) : 'queued';
  }
  if (kase.status === 'received') return 'queued';
  // The broker must handle it: the acknowledgement proposed with it does not change that.
  if (kase.status === 'needs_broker') return 'needs_broker';
  if ((kase.pendingProposals ?? 0) > 0 || kase.status === 'awaiting_approval') {
    return 'awaiting_approval';
  }
  switch (kase.status) {
    case 'failed':
      return 'failed';
    case 'needs_broker':
      return 'needs_broker';
    default:
      return 'done';
  }
}

/** Fills the summary of a follow-up e-mail or the case's e-mail (V14 attachments). */
function toEmailView(email: CaseWithDetail['email']): CaseDetail['email'] {
  return {
    from: email.from,
    to: email.to,
    subject: email.subject,
    body: email.body,
    receivedAt: email.receivedAt.toISOString(),
    language: email.language,
    attachments: email.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      type: attachment.type,
      extractedText: attachment.extractedText,
      sizeBytes: attachment.sizeBytes,
      pageCount: attachment.pageCount,
      extractionStatus: attachment.extractionStatus as 'ok' | 'failed' | 'not_applicable',
    })),
  };
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
    stage: caseStage({ ...kase, pendingProposals: kase.proposedActions.length }),
    currentTool: kase.status === 'processing' ? kase.currentTool : null,
    revision: kase._count.proposedActions,
    handoverReason: (kase.handoverReason as CaseSummary['handoverReason']) ?? null,
    followUps: kase._count.followUps,
    pendingProposals: kase.proposedActions.length,
  };
}

export function toCaseDetail(
  kase: CaseWithDetail,
  extra: {
    knownPolicyStatus: CaseDetail['knownPolicyStatus'];
    brokerNames: Map<string, string>;
    mergedInto: CaseDetail['mergedInto'];
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
    ...(event.result !== null ? { result: event.result } : {}),
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
    cancellation: (action.cancellation as ProposedActionView['cancellation']) ?? null,
    finalDraftSubject: action.finalDraftSubject,
    finalDraftBody: action.finalDraftBody,
    awaitsWorkflow: action.awaitsWorkflow,
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
  const pending = kase.proposedActions.filter((action) => action.status === 'pending');
  return {
    ...toCaseSummary({ ...kase, proposedActions: pending.map(({ id }) => ({ id })) }),
    followUps: kase.followUps.map((email) => ({
      id: email.id,
      ...toEmailView(email as CaseWithDetail['email']),
    })),
    handover: kase.handoverReason
      ? {
          reason: kase.handoverReason as NonNullable<CaseDetail['handover']>['reason'],
          params: (kase.handoverParams as NonNullable<CaseDetail['handover']>['params']) ?? {},
        }
      : null,
    mergedInto: extra.mergedInto,
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
    email: toEmailView(kase.email),
    steps,
    agentEvents,
    proposedActions,
    auditLogs,
  };
}
