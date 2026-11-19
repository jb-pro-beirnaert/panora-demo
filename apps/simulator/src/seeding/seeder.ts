import { toCoreSeed, toExtranetSeed, type World } from '@demo/world-generator';
import { adminPost, seedWhenReady } from './admin-client.js';

export interface SeedTargets {
  coreUrl: string;
  extranetUrl: string;
  adminToken: string;
}

/** Pushes each side of the world to the service that owns it (each writes its own database). */
export async function seedAll(world: World, targets: SeedTargets): Promise<void> {
  await Promise.all([
    seedWhenReady('mcp-extranet', targets.extranetUrl, targets.adminToken, toExtranetSeed(world)),
    seedWhenReady('core-api', targets.coreUrl, targets.adminToken, toCoreSeed(world)),
  ]);
}

/** Empties Core (tables + queues) and the extranet, then seeds both again. */
export async function resetAll(world: World, targets: SeedTargets): Promise<void> {
  await Promise.all([
    adminPost(targets.coreUrl, '/admin/reset', targets.adminToken),
    adminPost(targets.extranetUrl, '/admin/reset', targets.adminToken),
  ]);
  await seedAll(world, targets);
}
