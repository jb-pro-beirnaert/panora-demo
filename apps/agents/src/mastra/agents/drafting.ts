import { Agent } from '@mastra/core/agent';
import { dynamicModel } from '../models.js';
import { draftingInstructions } from '../prompts/drafting.js';

export const draftingAgent = new Agent({
  id: 'drafting-agent',
  name: 'Drafting agent',
  description:
    'Turns a coverage verdict into a proposed action: action type, e-mail draft to the client and internal note for the broker.',
  instructions: draftingInstructions,
  // Default from the env; the eval matrix can override it per request (V8).
  model: dynamicModel('drafting'),
  // No tools: it only writes from the facts it is given.
});
