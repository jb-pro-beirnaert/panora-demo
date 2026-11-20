import type { ClaimGroundTruth, ExtranetClause } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Observed } from '../lib/observed.js';
import { citationRule, normalizeText, scoreCoverage } from './coverage.js';
import { amountsIn, knownAmounts, scoreDrafting } from './drafting.js';
import { scoreOutcome } from './outcome.js';
import { scoreTriage } from './triage.js';

const truth: ClaimGroundTruth = {
  scenario: 'policy_terminated',
  requestType: 'claim',
  brokerCode: 'DLM-075',
  emailLanguage: 'fr',
  expectedDraftLanguage: 'fr',
  expectedNoteLanguage: 'fr',
  holderName: 'Boulangerie Martin SARL',
  policyNumber: 'C-48213',
  policyNumberInEmail: false,
  incidentDate: '2026-11-17',
  incidentDateReadable: true,
  nature: 'water_damage',
  amount: 1450,
  documentsMissing: [],
  verdict: 'not_covered',
  reason: 'policy_terminated',
  alerts: ['policy_terminated'],
  coverageLabel: 'Dégât des eaux',
  limit: 30000,
  deductible: 300,
  clauseRef: 'CG-HZ-12.1',
  expectedAction: 'notify_denial',
};

const clause: ExtranetClause = {
  ref: 'CG-HZ-12.1',
  insurerId: 'ins-horizon',
  title: 'Effets de la résiliation',
  text: "En cas de résiliation du contrat, les garanties cessent à la date d'effet de la résiliation. Aucune garantie n'est acquise pour les sinistres survenus après cette date.",
  general: true,
};
const clauses = new Map([[clause.ref, clause]]);

const good: Observed = {
  status: 'awaiting_approval',
  service: null,
  handoverReason: null,
  triage: {
    requestType: 'claim',
    emailLanguage: 'fr',
    policyNumber: null,
    incidentDate: '2026-11-17',
    nature: 'water_damage',
    amount: 1450,
  },
  coverage: {
    params: {
      verdict: 'not_covered',
      alerts: ['policy_terminated'],
      limit: 30000,
      deductible: 300,
    },
    citations: [
      {
        kind: 'clause',
        ref: 'CG-HZ-12.1',
        excerpt: 'Aucune garantie n’est acquise pour les sinistres survenus après cette date',
      },
    ],
  },
  proposal: {
    actionType: 'notify_denial',
    draftSubject: 'Votre sinistre dégât des eaux',
    draftBody:
      "Bonjour, nous sommes désolés : le contrat est résilié, l'assureur ne prendra pas en charge le sinistre de 1 450 €. Cordialement",
    internalNote:
      'Contrat résilié chez l’assureur alors que le cabinet le croit actif. Montant 1 450 €, plafond 30 000 €.',
    draftLanguage: 'fr',
    noteLanguage: 'fr',
  },
};

const values = (scores: { scorer: string; value: number | null }[]) =>
  Object.fromEntries(scores.map((score) => [score.scorer, score.value]));

describe('scorers', () => {
  it('give full marks to a correct case', () => {
    assert.deepEqual(values(scoreTriage(truth, good)), {
      request_type: 1,
      email_language: 1,
      fields: 1,
    });
    assert.deepEqual(values(scoreCoverage(truth, good, clauses)), {
      verdict: 1,
      alerts: 1,
      limit_deductible: 1,
      citations: 1,
    });
    assert.deepEqual(values(scoreDrafting(truth, good)), {
      action_type: 1,
      amounts: 1,
      languages: 1,
    });
  });

  it('penalise a wrong verdict, an invented amount and a draft in the wrong language', () => {
    const bad: Observed = {
      ...good,
      triage: { ...good.triage, policyNumber: 'C-99999' },
      coverage: { ...good.coverage!, params: { ...good.coverage!.params, verdict: 'covered' } },
      proposal: {
        ...good.proposal!,
        actionType: 'file_claim',
        draftBody:
          'Hello, we will file your claim and you will receive EUR 1,150 for the damage. Regards',
      },
    };
    assert.equal(values(scoreTriage(truth, bad)).fields, 0.75);
    assert.equal(values(scoreCoverage(truth, bad, clauses)).verdict, 0);
    const drafting = values(scoreDrafting(truth, bad));
    assert.equal(drafting.action_type, 0);
    assert.equal(drafting.languages, 0.5);
    // 1 150 = 1 450 − 300 is a known (payout-like) amount only for a covered claim: still listed.
    assert.ok(knownAmounts(truth).has(1150));
  });

  it('do not score coverage for an e-mail that is not a claim', () => {
    const scores = scoreCoverage(
      { ...truth, scenario: 'quote_request', requestType: 'quote_request' } as never,
      good,
      clauses,
    );
    assert.ok(scores.every((score) => score.value === null));
  });

  it('scores the outcome of a request (V15)', () => {
    const request = {
      ...truth,
      scenario: 'cancellation_late_notice',
      requestType: 'cancellation',
      subtype: null,
      expectedOutcome: 'action',
      expectedAction: 'cancel_policy',
      handoverReason: null,
      effectiveDate: '2027-12-27',
      followUpOf: null,
    } as never;
    const observed: Observed = {
      ...good,
      service: { effectiveDate: '2027-12-27', alerts: ['notice_period_not_met'] },
    };
    const byName = Object.fromEntries(
      scoreOutcome(request, observed).map((score) => [score.scorer, score.value]),
    );
    assert.deepEqual(byName, { outcome: 1, handover_reason: null, effective_date: 1 });
    const handedOver = scoreOutcome(
      {
        ...(request as object),
        expectedOutcome: 'needs_broker',
        handoverReason: 'quote_request',
      } as never,
      { ...good, status: 'needs_broker', handoverReason: 'quote_request' },
    );
    assert.deepEqual(
      handedOver.map((score) => score.value),
      [1, 1, 0],
    );
  });
});

describe('citationRule', () => {
  it('accepts a verbatim excerpt modulo whitespace and quotes', () => {
    assert.equal(normalizeText('Aucune  garantie n’est acquise.'), "aucune garantie n'est acquise");
    assert.equal(citationRule(good.coverage!.citations, clauses, 'CG-HZ-12.1').value, 1);
  });

  it('rejects a paraphrase, a missing clause and a missing deciding clause', () => {
    const paraphrase = [{ ref: 'CG-HZ-12.1', excerpt: 'No cover after termination.' }];
    assert.equal(citationRule(paraphrase, clauses, 'CG-HZ-12.1').value, 0);
    assert.match(citationRule([{ ref: 'CG-XX-1' }], clauses, null).comment, /does not exist/);
    const other = new Map([...clauses, ['CG-HZ-4.2', { ...clause, ref: 'CG-HZ-4.2' }]]);
    assert.equal(citationRule([{ ref: 'CG-HZ-4.2' }], other, 'CG-HZ-12.1').value, 0.5);
  });
});

describe('amountsIn', () => {
  it('reads French and English amounts', () => {
    assert.deepEqual(amountsIn('1 450 € et 30 000 €'), [1450, 30000]);
    assert.deepEqual(amountsIn('EUR 2,300 then €300.50 and 1,208.33 EUR'), [2300, 300, 1208]);
    assert.deepEqual(amountsIn('1 208,33 €'), [1208]);
  });
});
