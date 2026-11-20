import { AgentStepCallbackSchema, type CoverageVerdict, type TriageResult } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverageReports, executeReport, triageReport } from './step-reports.js';

const field = <T>(value: T | null, document = 'email_body', page: number | null = null) => ({
  value,
  source: value === null ? null : { document, page },
  confidence: (value === null ? 'low' : 'high') as 'low' | 'high',
});

const triage: TriageResult = {
  requestType: 'claim',
  subtype: null,
  caseReference: null,
  emailLanguage: 'fr',
  holderName: field('Boulangerie Martin SARL'),
  policyNumber: field<string>(null),
  incidentDate: field('2026-11-17', 'constat.pdf', 1),
  nature: field('water_damage' as const),
  location: field('12 rue des Lilas', 'constat.pdf', 1),
  amount: field(1450, 'facture_plombier.pdf', 1),
  documentsPresent: [],
  documentsMissing: [],
};

const terminated: CoverageVerdict = {
  verdict: 'not_covered',
  policyNumber: 'C-48213',
  policyStatus: 'terminated',
  coverage: { label: 'Dégât des eaux', peril: 'water_damage', clauseRef: 'CG-HZ-4.2' },
  limit: 30000,
  deductible: 300,
  claimedAmount: 1450,
  estimatedPayout: null,
  citations: [{ clauseRef: 'CG-HZ-12.1', excerpt: 'Aucune garantie après la résiliation.' }],
  alerts: ['policy_terminated'],
  reasoning: '…',
};

describe('triageReport', () => {
  it('reports the extracted facts with deduplicated sources', () => {
    const report = AgentStepCallbackSchema.parse(
      triageReport(triage, { model: 'openai/gpt-5-nano', durationMs: 1200 }),
    );
    assert.equal(report.stepType, 'triage.completed');
    assert.equal(report.params.amount, 1450);
    assert.deepEqual(report.params.lowConfidence, ['policyNumber']);
    assert.deepEqual(
      report.sources.map((source) => source.ref),
      ['constat.pdf', 'email_body', 'facture_plombier.pdf'],
    );
  });
});

describe('coverageReports', () => {
  it('reports the insurer status, then the verdict with the cited clauses', () => {
    const [policy, verdict] = coverageReports(terminated, { model: 'm', durationMs: 10 }).map(
      (report) => AgentStepCallbackSchema.parse(report),
    );
    assert.equal(policy?.stepType, 'coverage.policy_checked');
    assert.equal(policy?.params.status, 'terminated');
    assert.equal(verdict?.stepType, 'coverage.verdict');
    assert.deepEqual(verdict?.params.alerts, ['policy_terminated']);
    assert.equal(verdict?.sources[0]?.excerpt, 'Aucune garantie après la résiliation.');
  });

  it('skips the policy step when no policy was identified', () => {
    const reports = coverageReports(
      { ...terminated, policyNumber: null, policyStatus: null },
      { model: null, durationMs: 1 },
    );
    assert.deepEqual(
      reports.map((report) => report.stepType),
      ['coverage.verdict'],
    );
  });
});

describe('executeReport', () => {
  it('maps each outcome to its timeline step', () => {
    assert.equal(
      executeReport({ outcome: 'classified', requestType: 'unrelated', subtype: 'spam' }),
      null,
    );
    const action = {
      actionType: 'file_claim' as const,
      clientEmailDraft: { subject: 's', body: 'b' },
      internalNote: 'n',
      revision: 1,
      claimFiling: null,
      cancellation: null,
    };
    assert.equal(
      executeReport({
        outcome: 'claim_filed',
        claimNumber: 'S-1',
        action,
        approvedBy: 'b',
        finalDraft: null,
      })?.stepType,
      'execute.claim_filed',
    );
  });
});
