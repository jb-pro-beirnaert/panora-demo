import type {
  AgentStepCallback,
  CoverageVerdict,
  ProcessEmailResult,
  ProposedAction,
  StepSource,
  TriageResult,
} from '@demo/shared';

/** Business-level step reports sent to Core, built from the agents' structured outputs. */

export interface Timing {
  model: string | null;
  durationMs: number;
}

function documentSource(document: string, page: number | null): StepSource {
  return document === 'email_body' || document === 'email_subject'
    ? { kind: 'email', ref: document }
    : { kind: 'attachment', ref: document, page };
}

export function triageReport(triage: TriageResult, timing: Timing): AgentStepCallback {
  const sources = new Map<string, StepSource>();
  for (const field of [
    triage.policyNumber,
    triage.incidentDate,
    triage.nature,
    triage.location,
    triage.amount,
  ]) {
    if (field.source) {
      const source = documentSource(field.source.document, field.source.page);
      sources.set(`${source.ref}#${source.page ?? ''}`, source);
    }
  }
  return {
    agent: 'triage',
    stepType: 'triage.completed',
    params: {
      requestType: triage.requestType,
      emailLanguage: triage.emailLanguage,
      policyNumber: triage.policyNumber.value,
      nature: triage.nature.value,
      incidentDate: triage.incidentDate.value,
      amount: triage.amount.value,
      documentsMissing: triage.documentsMissing,
      lowConfidence: (
        [
          ['policyNumber', triage.policyNumber.confidence],
          ['incidentDate', triage.incidentDate.confidence],
          ['amount', triage.amount.confidence],
        ] as const
      )
        .filter(([, confidence]) => confidence === 'low')
        .map(([name]) => name),
    },
    sources: [...sources.values()],
    model: timing.model,
    durationMs: timing.durationMs,
  };
}

export function classifiedReport(requestType: string): AgentStepCallback {
  return { agent: 'system', stepType: 'triage.classified', params: { requestType } };
}

/** One report for the policy status at the insurer, one for the verdict (with clause citations). */
export function coverageReports(coverage: CoverageVerdict, timing: Timing): AgentStepCallback[] {
  const reports: AgentStepCallback[] = [];
  if (coverage.policyNumber) {
    reports.push({
      agent: 'coverage',
      stepType: 'coverage.policy_checked',
      params: { policyNumber: coverage.policyNumber, status: coverage.policyStatus },
      sources: [{ kind: 'mcp_tool', ref: 'get_policy' }],
    });
  }
  reports.push({
    agent: 'coverage',
    stepType: 'coverage.verdict',
    params: {
      verdict: coverage.verdict,
      alerts: coverage.alerts,
      policyNumber: coverage.policyNumber,
      coverage: coverage.coverage?.label ?? null,
      limit: coverage.limit,
      deductible: coverage.deductible,
      claimedAmount: coverage.claimedAmount,
      estimatedPayout: coverage.estimatedPayout,
    },
    sources: coverage.citations.map((citation) => ({
      kind: 'clause',
      ref: citation.clauseRef,
      excerpt: citation.excerpt,
    })),
    model: timing.model,
    durationMs: timing.durationMs,
  });
  return reports;
}

export function draftReport(action: ProposedAction, timing: Timing): AgentStepCallback {
  return {
    agent: 'drafting',
    stepType: 'drafting.proposed',
    params: { actionType: action.actionType, revision: action.revision },
    model: timing.model,
    durationMs: timing.durationMs,
  };
}

export function executeReport(result: ProcessEmailResult): AgentStepCallback | null {
  if (result.outcome === 'claim_filed') {
    return {
      agent: 'system',
      stepType: 'execute.claim_filed',
      params: {
        claimNumber: result.claimNumber,
        amount: result.action.claimFiling?.amount ?? null,
      },
      sources: [{ kind: 'mcp_tool', ref: 'file_claim' }],
    };
  }
  if (result.outcome === 'ready_to_send') {
    return {
      agent: 'system',
      stepType: 'execute.ready_to_send',
      params: { actionType: result.action.actionType },
    };
  }
  return null;
}
