import { Agent } from '@mastra/core/agent';
import { env } from '../env.js';
import { triageInstructions } from '../prompts/triage.js';
import { findClientTool } from '../tools/find-client.js';

export const triageAgent = new Agent({
  id: 'triage-agent',
  name: 'Triage agent',
  description: 'Classifies an inbound e-mail and extracts the claim facts (TriageResult).',
  instructions: triageInstructions,
  model: env.TRIAGE_MODEL,
  // Read-only lookup in the brokerage's software (Core).
  tools: { find_client: findClientTool },
});
