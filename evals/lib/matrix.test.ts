import type { EvalReport } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentScore, effectiveModels, matrixMarkdown } from './matrix.js';

const report: EvalReport = {
  runId: 'r',
  startedAt: 's',
  finishedAt: 'f',
  dataset: { name: 'seed-7', seed: 7, size: 2 },
  models: {},
  judge: null,
  cases: [],
  costPerCaseUsd: 0.0034,
  latencyMs: { p50: 78_000, p95: 98_000 },
  aggregates: [
    { agent: 'triage', scorer: 'fields', mean: 1, count: 2, byLanguage: { fr: 1, en: 1 } },
    { agent: 'triage', scorer: 'request_type', mean: 0.5, count: 2, byLanguage: { fr: 0, en: 1 } },
    {
      agent: 'workflow',
      scorer: 'case_correct',
      mean: 0.5,
      count: 2,
      byLanguage: { fr: 0, en: 1 },
    },
  ],
};

describe('matrix', () => {
  it('scores an agent as the mean of its scorers, per language', () => {
    assert.equal(agentScore(report, 'triage'), 0.75);
    assert.equal(agentScore(report, 'triage', 'fr'), 0.5);
    assert.equal(agentScore(report, 'drafting'), null);
  });

  it('applies the overrides on top of the default models', () => {
    assert.deepEqual(
      effectiveModels(
        { models: { triage: 'openai/gpt-5.4-nano' } },
        {
          triage: 'openai/gpt-5-nano',
          coverage: 'openai/gpt-6-luna',
          drafting: 'openai/gpt-6-luna',
        },
      ),
      {
        triage: 'openai/gpt-5.4-nano',
        coverage: 'openai/gpt-6-luna',
        drafting: 'openai/gpt-6-luna',
      },
    );
  });

  it('renders one comparison row per configuration', () => {
    const markdown = matrixMarkdown(
      [
        {
          config: {
            name: 'triage: gpt-5.4-nano',
            group: 'triage',
            runOptions: { models: { triage: 'openai/gpt-5.4-nano' } },
          },
          models: { triage: 'openai/gpt-5.4-nano', coverage: 'c', drafting: 'd' },
          report,
        },
      ],
      2,
    );
    assert.match(
      markdown,
      /\| triage: gpt-5.4-nano \| triage \| `openai\/gpt-5.4-nano` \| 75.0 \| 50.0 \| 100.0 \| 50.0 \| \$0.0034 \| 78 s \/ 98 s \|/,
    );
  });
});
