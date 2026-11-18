import { Agent } from '@mastra/core/agent';
import { env } from '../env.js';
import { draftingInstructions } from '../prompts/drafting.js';

export const draftingAgent = new Agent({
  id: 'drafting-agent',
  name: 'Drafting agent',
  description:
    'Turns a coverage verdict into a proposed action: action type, e-mail draft to the client and internal note for the broker.',
  instructions: draftingInstructions,
  model: env.DRAFTING_MODEL,
  // No tools: it only writes from the facts it is given.
});
