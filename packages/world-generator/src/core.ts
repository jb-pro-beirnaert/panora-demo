import { CoreSeedSchema, type CoreSeed } from '@demo/shared';
import type { World } from './types.js';

/** The brokerage-side part of the world, as `POST /admin/seed` of Core expects it. */
export function toCoreSeed(world: World): CoreSeed {
  return CoreSeedSchema.parse({
    brokerages: world.brokerages.map(({ id, name, brokerCode, locale, inboxEmail }) => ({
      id,
      name,
      brokerCode,
      locale,
      inboxEmail,
    })),
    brokers: world.brokers,
    clients: world.clients.map(({ id, brokerageId, companyName, siren, email, contactName }) => ({
      id,
      brokerageId,
      companyName,
      siren,
      email,
      contactName,
    })),
    policies: world.brokeragePolicies,
  });
}
