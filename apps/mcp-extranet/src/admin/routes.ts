import { ExtranetSeedSchema, type ExtranetSeed } from '@demo/shared';
import { Router } from 'express';
import { z } from 'zod';
import { fromIsoDate, normalizeName, type Db } from '../db.js';
import { requireAdminToken } from './require-admin-token.js';

async function reset(db: Db): Promise<void> {
  // Children first; CallLog is wiped too so a demo reset starts clean.
  await db.$transaction([
    db.callLog.deleteMany(),
    db.claim.deleteMany(),
    db.coverage.deleteMany(),
    db.policy.deleteMany(),
    db.clause.deleteMany(),
    db.insurer.deleteMany(),
  ]);
}

async function seed(db: Db, world: ExtranetSeed): Promise<void> {
  await reset(db);
  await db.$transaction([
    db.insurer.createMany({ data: world.insurers }),
    db.clause.createMany({ data: world.clauses }),
    db.policy.createMany({
      data: world.policies.map(({ coverages: _coverages, ...policy }) => ({
        ...policy,
        holderNameSearch: normalizeName(policy.holderName),
        startDate: fromIsoDate(policy.startDate),
        endDate: policy.endDate ? fromIsoDate(policy.endDate) : null,
        renewalDate: fromIsoDate(policy.renewalDate),
        cancellationRequestedAt: policy.cancellationRequestedAt
          ? fromIsoDate(policy.cancellationRequestedAt)
          : null,
      })),
    }),
    db.coverage.createMany({
      data: world.policies.flatMap((policy) =>
        policy.coverages.map((coverage) => ({ ...coverage, policyNumber: policy.number })),
      ),
    }),
    db.claim.createMany({
      data: world.claims.map((claim) => ({ ...claim, date: fromIsoDate(claim.date) })),
    }),
  ]);
}

/** `/admin/*`: mounted only when DEMO_MODE=true. */
export function adminRouter(db: Db, adminToken: string): Router {
  const router = Router();
  router.use(requireAdminToken(adminToken));

  router.post('/seed', async (req, res) => {
    const parsed = ExtranetSeedSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'invalid seed payload', details: z.treeifyError(parsed.error) });
      return;
    }
    await seed(db, parsed.data);
    const counts = {
      insurers: parsed.data.insurers.length,
      clauses: parsed.data.clauses.length,
      policies: parsed.data.policies.length,
      claims: parsed.data.claims.length,
    };
    console.log('extranet seeded', counts);
    res.json({ status: 'seeded', counts });
  });

  router.post('/reset', async (_req, res) => {
    await reset(db);
    console.log('extranet reset');
    res.json({ status: 'reset' });
  });

  return router;
}
