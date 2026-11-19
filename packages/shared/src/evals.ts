import { z } from 'zod';
import { LocaleSchema } from './domain.js';

/** Eval reports (V7): written by `npm run evals`, shown by the web UI's Evals screen. */

export const EvalAgentSchema = z.enum(['triage', 'coverage', 'drafting', 'workflow']);
export type EvalAgent = z.infer<typeof EvalAgentSchema>;

/** One scorer's result on one case: a score in [0, 1], or null when it does not apply. */
export const EvalScoreSchema = z.object({
  agent: EvalAgentSchema,
  scorer: z.string(),
  value: z.number().min(0).max(1).nullable(),
  comment: z.string().optional(),
});
export type EvalScore = z.infer<typeof EvalScoreSchema>;

export const EvalCaseResultSchema = z.object({
  id: z.string(),
  scenario: z.string(),
  language: LocaleSchema,
  caseId: z.string().nullable(),
  traceId: z.string().nullable(),
  /** Workflow error or timeout; the case then scores 0 everywhere. */
  error: z.string().nullable(),
  scores: z.array(EvalScoreSchema),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

/** Mean of a scorer, overall and per language (null when no case applied). */
export const EvalAggregateSchema = z.object({
  agent: EvalAgentSchema,
  scorer: z.string(),
  mean: z.number().nullable(),
  count: z.number().int(),
  byLanguage: z.record(LocaleSchema, z.number().nullable()),
});
export type EvalAggregate = z.infer<typeof EvalAggregateSchema>;

export const EvalReportSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  dataset: z.object({ name: z.string(), seed: z.number(), size: z.number().int() }),
  models: z.record(z.string(), z.string()),
  judge: z.string().nullable(),
  aggregates: z.array(EvalAggregateSchema),
  cases: z.array(EvalCaseResultSchema),
  /** Average cost and latency per case, when known (V8). */
  costPerCaseUsd: z.number().nullable().optional(),
  latencyMs: z.object({ p50: z.number(), p95: z.number() }).nullable().optional(),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;
