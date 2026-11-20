import type { EvalScore, ExtranetClause, GroundTruth } from '@demo/shared';
import { z } from 'zod';
import type { Observed } from '../lib/observed.js';

/**
 * LLM-as-judge (cheap model, one call per claim case): does each citation support what the verdict
 * claims, and is the client draft courteous and complete? Called through the OpenAI API directly so
 * the judge is independent from the agents under test.
 */
const JudgmentSchema = z.object({
  citationsSupportVerdict: z.number().min(0).max(1),
  draftToneAndCompleteness: z.number().min(0).max(1),
  reasons: z.string(),
});

export interface JudgeOptions {
  apiKey: string;
  /** OpenAI model id, e.g. `gpt-5-nano`. */
  model: string;
}

export function judgePrompt(
  truth: GroundTruth,
  observed: Observed,
  clauses: ReadonlyMap<string, ExtranetClause>,
): string {
  const cited = (observed.coverage?.citations ?? [])
    .map((citation) => {
      const clause = clauses.get(citation.ref);
      return `- ${citation.ref}: excerpt "${citation.excerpt ?? ''}"\n  full clause: ${clause?.text ?? '(does not exist)'}`;
    })
    .join('\n');
  return [
    'You grade the output of an insurance claims assistant. Answer with JSON only:',
    '{"citationsSupportVerdict": 0..1, "draftToneAndCompleteness": 0..1, "reasons": "one or two sentences"}',
    '- citationsSupportVerdict: 1 if the cited clauses really say what is needed to justify the verdict, 0 if they are irrelevant or contradict it.',
    '- draftToneAndCompleteness: 1 if the e-mail to the client is courteous, factual, does not promise a payment, and contains what the client needs for this action (reason of a denial with the clause, list of documents to send, or confirmation of the declaration with deductible and limit). 0 if rude, misleading or missing the essentials.',
    `Expected verdict: ${truth.requestType === 'claim' ? truth.verdict : 'n/a (not a claim)'}; expected action: ${truth.expectedAction ?? 'none'}.`,
    `Verdict given: ${JSON.stringify(observed.coverage?.params ?? null)}`,
    `Citations:\n${cited || '(none)'}`,
    `E-mail draft to the client:\nSubject: ${observed.proposal?.draftSubject ?? ''}\n${observed.proposal?.draftBody ?? '(none)'}`,
  ].join('\n\n');
}

export async function judge(
  truth: GroundTruth,
  observed: Observed,
  clauses: ReadonlyMap<string, ExtranetClause>,
  options: JudgeOptions,
): Promise<EvalScore[]> {
  if (!observed.proposal) return [];
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: judgePrompt(truth, observed, clauses) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    const body = (await response.json()) as { choices: { message: { content: string } }[] };
    const judgment = JudgmentSchema.parse(JSON.parse(body.choices[0]?.message.content ?? '{}'));
    const scores: EvalScore[] = [
      {
        agent: 'drafting',
        scorer: 'tone_completeness_judge',
        value: judgment.draftToneAndCompleteness,
        comment: judgment.reasons,
      },
    ];
    if (truth.scenario !== 'unknown_client') {
      scores.push({
        agent: 'coverage',
        scorer: 'citations_judge',
        value: judgment.citationsSupportVerdict,
        comment: judgment.reasons,
      });
    }
    return scores;
  } catch (error) {
    console.error(`judge failed: ${String(error)}`);
    return [];
  }
}
