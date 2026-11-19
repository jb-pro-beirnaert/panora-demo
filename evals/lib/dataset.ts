import { GroundTruthSchema, InboundEmailInputSchema, type Locale } from '@demo/shared';
import { generateEmails, generateWorld } from '@demo/world-generator';
import { z } from 'zod';

/** The eval world: French and English data, with more English than the demo to balance scores. */
export const EVAL_WORLD_MIX = { en: 0.4 };

export const EvalCaseSchema = z.object({
  id: z.string(),
  email: InboundEmailInputSchema,
  groundTruth: GroundTruthSchema,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const DatasetSchema = z.object({
  name: z.string(),
  seed: z.number().int(),
  mix: z.object({ en: z.number() }),
  cases: z.array(EvalCaseSchema),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export function worldOf(dataset: Pick<Dataset, 'seed' | 'mix'>) {
  return generateWorld({ seed: dataset.seed, locales: ['fr', 'en'], mix: dataset.mix });
}

/**
 * Same library as the simulator, so the evals contain the same traps as the demo. Message ids are
 * namespaced so eval e-mails never collide with demo e-mails in Core.
 */
export function generateDataset(seed: number, count: number): Dataset {
  const mix = EVAL_WORLD_MIX;
  const world = worldOf({ seed, mix });
  const cases = generateEmails(world, { seed, count }).map(({ email, groundTruth }, index) => {
    const id = `eval-${seed}-${String(index + 1).padStart(3, '0')}`;
    return { id, email: { ...email, messageId: `<${id}@evals.local>` }, groundTruth };
  });
  return { name: `seed-${seed}`, seed, mix, cases };
}

export function languageOf(evalCase: EvalCase): Locale {
  return evalCase.groundTruth.emailLanguage;
}
