import { createHash } from 'node:crypto';
import { coverageInstructions } from './coverage.js';
import { draftingInstructions } from './drafting.js';
import { singleAgentInstructions } from './single.js';
import { triageInstructions } from './triage.js';

const version = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** Short hash of each prompt: attached to traces so a score can be tied to a prompt version. */
export const PROMPT_VERSIONS = {
  triage: version(triageInstructions),
  coverage: version(coverageInstructions),
  drafting: version(draftingInstructions),
  single: version(singleAgentInstructions),
} as const;
