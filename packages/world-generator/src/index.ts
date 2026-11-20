// Seeded fictional world generator. Pure library: no database, no network, no clock.
export { generateWorld, DEFAULT_REFERENCE_DATE, SHOWCASE, WORLD_SIZE } from './world.js';
export type { GenerateWorldOptions } from './world.js';
export {
  DEMO_SCRIPT,
  generateDemoScript,
  generateEmails,
  SCENARIO_ORDER,
  SCENARIO_WEIGHTS,
} from './emails.js';
export type { DemoScriptEntry, GenerateEmailsOptions } from './emails.js';
export { toExtranetSeed } from './extranet.js';
export { toCoreSeed } from './core.js';
export type * from './types.js';
