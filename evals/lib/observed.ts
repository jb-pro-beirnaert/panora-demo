import type { CaseDetail, Locale, StepParams, StepSource } from '@demo/shared';

/** What the agents produced for one case, read back from Core's case detail. */
export interface Observed {
  status: CaseDetail['status'];
  triage: StepParams | null;
  coverage: { params: StepParams; citations: StepSource[] } | null;
  /** V15: the policy service analysis (cancellations, questions). */
  service: { effectiveDate: string | null; alerts: string[] } | null;
  handoverReason: string | null;
  proposal: {
    actionType: string;
    draftSubject: string;
    draftBody: string;
    internalNote: string;
    draftLanguage: Locale;
    noteLanguage: Locale;
    /** V18: what would be declared at the insurer. */
    claimFiling: Record<string, unknown> | null;
  } | null;
}

export function observe(kase: CaseDetail): Observed {
  const step = (type: string) => kase.steps.find((candidate) => candidate.stepType === type);
  const triage = step('triage.completed');
  const verdict = step('coverage.verdict');
  const first = kase.proposedActions[0];
  const service = step('service.analysis');
  return {
    status: kase.status,
    triage: triage?.params ?? null,
    coverage: verdict
      ? {
          params: verdict.params,
          citations: verdict.sources.filter((source) => source.kind === 'clause'),
        }
      : null,
    service: service
      ? {
          effectiveDate:
            typeof service.params.effectiveDate === 'string' ? service.params.effectiveDate : null,
          alerts: Array.isArray(service.params.alerts) ? service.params.alerts : [],
        }
      : null,
    handoverReason: kase.handover?.reason ?? kase.handoverReason ?? null,
    proposal: first
      ? {
          actionType: first.actionType,
          draftSubject: first.draftSubject,
          draftBody: first.draftBody,
          internalNote: first.internalNote,
          draftLanguage: first.draftLanguage,
          noteLanguage: first.noteLanguage,
          claimFiling: first.claimFiling,
        }
      : null,
  };
}
