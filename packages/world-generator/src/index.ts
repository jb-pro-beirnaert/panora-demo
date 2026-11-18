// Seeded fictional world generator. Pure library: no database, no network, no clock.
export { generateWorld, DEFAULT_REFERENCE_DATE, SHOWCASE, WORLD_SIZE } from './world.js';
export type { GenerateWorldOptions } from './world.js';
export { generateEmails, SCENARIO_ORDER, SCENARIO_WEIGHTS } from './emails.js';
export type { GenerateEmailsOptions } from './emails.js';
export { toExtranetSeed } from './extranet.js';
export type * from './types.js';
