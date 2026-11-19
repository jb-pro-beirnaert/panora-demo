import type { EvalReport } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkGate } from './gate.js';
import { aggregate, toMarkdown, withWorkflowScore } from './report.js';

function report(verdictMean: number): EvalReport {
  return {
    runId: 'r',
    startedAt: 's',
    finishedAt: 'f',
    dataset: { name: 'seed-7', seed: 7, size: 2 },
    models: {},
    judge: null,
    cases: [],
    aggregates: [
      {
        agent: 'coverage',
        scorer: 'verdict',
        mean: verdictMean,
        count: 2,
        byLanguage: { fr: verdictMean, en: null },
      },
    ],
  };
}

describe('checkGate', () => {
  it('passes when every score is above its threshold and the baseline', () => {
    assert.deepEqual(checkGate(report(0.9), { 'coverage/verdict': 0.7 }, report(0.9)), []);
  });

  it('fails under the threshold', () => {
    const failures = checkGate(report(0.6), { 'coverage/verdict': 0.7 });
    assert.match(failures[0]?.reason ?? '', /60.0 is below the threshold 70.0/);
  });

  it('fails on a drop of more than 2 points against the baseline, with before/after', () => {
    assert.deepEqual(checkGate(report(0.885), {}, report(0.9)), []);
    const failures = checkGate(report(0.85), {}, report(0.9));
    assert.match(failures[0]?.reason ?? '', /dropped 5.0 points: 90.0 → 85.0/);
  });
});

describe('report', () => {
  it('aggregates per scorer and per language, and flags incorrect cases', () => {
    const ok = withWorkflowScore(
      [
        { agent: 'coverage', scorer: 'verdict', value: 1 },
        { agent: 'drafting', scorer: 'action_type', value: 1 },
      ],
      null,
    );
    const ko = withWorkflowScore([{ agent: 'coverage', scorer: 'verdict', value: 0 }], null);
    const aggregates = aggregate([
      {
        id: 'a',
        scenario: 'covered',
        language: 'fr',
        caseId: null,
        traceId: null,
        error: null,
        scores: ok,
      },
      {
        id: 'b',
        scenario: 'covered',
        language: 'en',
        caseId: null,
        traceId: 't',
        error: null,
        scores: ko,
      },
    ]);
    const verdict = aggregates.find((a) => a.scorer === 'verdict');
    assert.deepEqual(verdict?.byLanguage, { fr: 1, en: 0 });
    assert.equal(aggregates.find((a) => a.scorer === 'case_correct')?.mean, 0.5);
    const markdown = toMarkdown(
      {
        ...report(0.5),
        aggregates,
        cases: [
          {
            id: 'b',
            scenario: 'covered',
            language: 'en',
            caseId: null,
            traceId: 't',
            error: null,
            scores: ko,
          },
        ],
      },
      (id) => `https://lf/trace/${id}`,
    );
    assert.match(markdown, /failed: coverage\/verdict — \[trace\]\(https:\/\/lf\/trace\/t\)/);
  });
});

describe('dataset', () => {
  it('is reproducible', async () => {
    const { generateDataset } = await import('./dataset.js');
    assert.deepEqual(generateDataset(7, 5), generateDataset(7, 5));
  });
});
