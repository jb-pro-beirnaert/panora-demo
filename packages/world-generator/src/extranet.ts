import { ExtranetSeedSchema, type ExtranetSeed } from '@demo/shared';
import type { World } from './types.js';

/** The insurer-side part of the world, as `POST /admin/seed` of the MCP server expects it. */
export function toExtranetSeed(world: World): ExtranetSeed {
  return ExtranetSeedSchema.parse({
    insurers: world.insurers,
    clauses: world.clauses,
    policies: world.policies,
    claims: world.claims,
  });
}
