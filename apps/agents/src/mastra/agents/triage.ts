import { Agent } from '@mastra/core/agent';
import { dynamicModel } from '../models.js';
import { triageInstructions } from '../prompts/triage.js';
import { findClientTool } from '../tools/find-client.js';

export const triageAgent = new Agent({
  id: 'triage-agent',
  name: 'Triage agent',
  description: 'Classifies an inbound e-mail and extracts the claim facts (TriageResult).',
  instructions: triageInstructions,
  // Default from the env; the eval matrix can override it per request (V8).
  model: dynamicModel('triage'),
  // Read-only lookup in the brokerage's software (Core).
  tools: { find_client: findClientTool },
});
