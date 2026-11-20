import type {
  ActionType,
  CoverageVerdict,
  Draft,
  FileClaimInput,
  ProposedAction,
} from '@demo/shared';
import type { ApprovalRound, TriagedEmail } from './schemas.js';

/**
 * Arguments of `file_claim`, built from the triage and the verdict (never by the LLM), or null
 * when the facts needed to declare the claim are not all known.
 */
export function buildClaimFiling(
  claim: TriagedEmail,
  coverage: CoverageVerdict,
): FileClaimInput | null {
  const date = claim.triage.incidentDate.value;
  const amount = coverage.claimedAmount ?? claim.triage.amount.value;
  if (
    coverage.verdict !== 'covered' ||
    !coverage.policyNumber ||
    !coverage.coverage ||
    !date ||
    !amount ||
    amount <= 0
  ) {
    return null;
  }
  const location = claim.triage.location.value;
  return {
    policyNumber: coverage.policyNumber,
    date,
    nature: coverage.coverage.peril,
    amount,
    documents: claim.triage.documentsPresent.map((document) => document.fileName),
    description: `${claim.email.subject}${location ? ` (${location})` : ''}`.slice(0, 2_000),
  };
}

/** Why `actionType` cannot be proposed for this case, or null when it can. */
export function actionTypeProblem(
  actionType: ActionType,
  filing: FileClaimInput | null,
): string | null {
  if (actionType === 'file_claim' && !filing) {
    return 'actionType "file_claim" requires a "covered" verdict with a known policy, coverage, incident date and amount. Choose "request_documents" or "notify_denial".';
  }
  return null;
}

export function toProposedAction(
  draft: Draft,
  rounds: ApprovalRound[],
  filing: FileClaimInput | null,
): ProposedAction {
  return {
    ...draft,
    revision: rounds.length + 1,
    claimFiling: draft.actionType === 'file_claim' ? filing : null,
    cancellation: null,
  };
}
