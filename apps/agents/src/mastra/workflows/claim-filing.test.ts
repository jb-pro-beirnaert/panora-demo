import type { CoverageVerdict, TriageResult } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionTypeProblem, buildClaimFiling, toProposedAction } from './claim-filing.js';
import type { TriagedEmail } from './schemas.js';

const field = <T>(value: T | null) => ({
  value,
  source: value === null ? null : { document: 'email_body', page: null },
  confidence: 'high' as const,
});

const triage: TriageResult = {
  requestType: 'claim',
  holderName: field('Transports Lefèvre'),
  policyNumber: field('F-77102'),
  incidentDate: field('2026-11-15'),
  nature: field('glass_breakage'),
  location: field('A1'),
  amount: field(420),
  documentsPresent: [{ type: 'invoice', fileName: 'facture_vitrage.pdf' }],
  documentsMissing: [],
};

const claim: TriagedEmail = {
  caseId: null,
  client: null,
  email: {
    messageId: '<1@test>',
    from: 'contact@transports-lefevre.fr',
    to: 'sinistres@delorme-courtage.fr',
    subject: 'Bris de glace camion AB-456-EF',
    body: '…',
    receivedAt: '2026-11-16T09:12:00.000Z',
    attachments: [],
  },
  brokerage: { brokerCode: 'DLM-075', locale: 'fr' },
  rendered: '…',
  receivedDate: '2026-11-16',
  triage,
};

const covered: CoverageVerdict = {
  verdict: 'covered',
  policyNumber: 'F-77102',
  policyStatus: 'active',
  coverage: { label: 'Bris de glace', peril: 'glass_breakage', clauseRef: 'CG-AT-7.1' },
  limit: 2_000,
  deductible: 0,
  claimedAmount: 420,
  estimatedPayout: 420,
  citations: [{ clauseRef: 'CG-AT-7.1', excerpt: '…' }],
  alerts: [],
  reasoning: '…',
};

describe('buildClaimFiling', () => {
  it('builds the file_claim arguments from the facts, not from the LLM', () => {
    assert.deepEqual(buildClaimFiling(claim, covered), {
      policyNumber: 'F-77102',
      date: '2026-11-15',
      nature: 'glass_breakage',
      amount: 420,
      documents: ['facture_vitrage.pdf'],
      description: 'Bris de glace camion AB-456-EF (A1)',
    });
  });

  it('returns null unless the claim is covered with every fact known', () => {
    assert.equal(buildClaimFiling(claim, { ...covered, verdict: 'not_covered' }), null);
    assert.equal(buildClaimFiling(claim, { ...covered, policyNumber: null }), null);
    const noDate = { ...claim, triage: { ...triage, incidentDate: field<string>(null) } };
    assert.equal(buildClaimFiling(noDate, covered), null);
    const noAmount = { ...claim, triage: { ...triage, amount: field<number>(null) } };
    assert.equal(buildClaimFiling(noAmount, { ...covered, claimedAmount: null }), null);
  });
});

describe('actionTypeProblem', () => {
  it('refuses file_claim without filing arguments', () => {
    assert.match(actionTypeProblem('file_claim', null) ?? '', /requires a "covered" verdict/);
    assert.equal(actionTypeProblem('notify_denial', null), null);
    assert.equal(actionTypeProblem('file_claim', buildClaimFiling(claim, covered)), null);
  });
});

describe('toProposedAction', () => {
  const draft = {
    actionType: 'request_documents' as const,
    clientEmailDraft: { subject: 's', body: 'b' },
    internalNote: 'n',
  };

  it('numbers revisions and only attaches the filing to file_claim', () => {
    const filing = buildClaimFiling(claim, covered);
    const first = toProposedAction(draft, [], filing);
    assert.equal(first.revision, 1);
    assert.equal(first.claimFiling, null);
    const rejected = { action: first, decision: { approved: false, brokerId: 'b-1' } };
    const second = toProposedAction({ ...draft, actionType: 'file_claim' }, [rejected], filing);
    assert.equal(second.revision, 2);
    assert.deepEqual(second.claimFiling, filing);
  });
});
