import type {
  InsurerClauses,
  InsurerPolicyDetail,
  InsurerPolicySummary,
  PolicyEndReason,
} from '@demo/shared';
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../auth/authenticate.js';
import { normalizeName, toIsoDate, type Db } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { logCall, type ToolContext } from '../tools/define-tool.js';
import { findOwnPolicy } from '../tools/policy-access.js';

/**
 * V17 broker portal: read-only REST views of the extranet, for the broker's UI (through Core).
 * Same tokens as MCP (a `read` token is enough), same brokerage isolation, and every call is
 * logged in `CallLog` with the channel `portal`.
 */

type PolicyRow = Prisma.PolicyGetPayload<{ include: { insurer: true } }>;

function summary(policy: PolicyRow): InsurerPolicySummary {
  return {
    number: policy.number,
    insurer: {
      id: policy.insurer.id,
      name: policy.insurer.name,
      locale: policy.insurer.locale as 'fr' | 'en',
    },
    holderName: policy.holderName,
    product: policy.product,
    status: policy.status,
    startDate: toIsoDate(policy.startDate),
    endDate: policy.endDate ? toIsoDate(policy.endDate) : null,
    endReason: (policy.endReason as PolicyEndReason | null) ?? null,
    renewalDate: toIsoDate(policy.renewalDate),
    cancellationRequestedAt: policy.cancellationRequestedAt
      ? toIsoDate(policy.cancellationRequestedAt)
      : null,
  };
}

export function portalRouter(db: Db, secret: string): Router {
  const router = Router();

  /** Authenticates, runs and logs one portal call. */
  const handle =
    (
      tool: string,
      run: (
        ctx: ToolContext,
        req: Request,
      ) => Promise<{ data: unknown } | { error: string; status: number }>,
    ) =>
    async (req: Request, res: Response) => {
      const claims = authenticate(req, secret);
      if (!claims) {
        res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Unauthorized.' });
        return;
      }
      const ctx: ToolContext = {
        db,
        brokerCode: claims.brokerCode,
        scope: claims.scope,
        channel: 'portal',
      };
      const started = Date.now();
      const outcome = await run(ctx, req);
      await logCall(
        ctx,
        tool,
        { ...req.params, ...req.query },
        'data' in outcome ? { data: { ok: true } } : { error: outcome.error },
        Date.now() - started,
      );
      if ('data' in outcome) res.json(outcome.data);
      else res.status(outcome.status).json({ error: outcome.error });
    };

  router.get(
    '/policies',
    handle('portal:list_policies', async (ctx, req) => {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const policies = await db.policy.findMany({
        where: {
          brokerCode: ctx.brokerCode,
          ...(query
            ? {
                OR: [
                  { number: { contains: query.toUpperCase() } },
                  { holderNameSearch: { contains: normalizeName(query) } },
                ],
              }
            : {}),
        },
        include: { insurer: true },
        orderBy: { number: 'asc' },
      });
      return { data: policies.map(summary) };
    }),
  );

  router.get(
    '/policies/:number',
    handle('portal:get_policy', async (ctx, req) => {
      const found = await findOwnPolicy(ctx, String(req.params.number), {
        insurer: { include: { clauses: { where: { general: true } } } },
        coverages: { orderBy: { id: 'asc' } },
        claims: { orderBy: [{ date: 'desc' }, { number: 'desc' }] },
      });
      if ('error' in found) {
        return { error: found.error, status: found.error.startsWith('Access denied') ? 403 : 404 };
      }
      const { policy } = found;
      const detail: InsurerPolicyDetail = {
        ...summary(policy),
        holderSiren: policy.holderSiren,
        coverages: policy.coverages.map((coverage) => ({
          peril: coverage.peril,
          label: coverage.label,
          limit: coverage.limit,
          deductible: coverage.deductible,
          exclusions: coverage.exclusions,
          clauseRef: coverage.clauseRef,
        })),
        generalClauses: policy.insurer.clauses
          .sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }))
          .map((clause) => ({ ref: clause.ref, title: clause.title })),
        claims: policy.claims.map((claim) => ({
          number: claim.number,
          date: toIsoDate(claim.date),
          nature: claim.nature,
          amount: claim.amount,
          status: claim.status as InsurerPolicyDetail['claims'][number]['status'],
          description: claim.description,
          filedBy: claim.filedBy,
        })),
      };
      return { data: detail };
    }),
  );

  /** The general conditions of the insurer that wrote a clause, every clause in full. */
  router.get(
    '/clauses/:ref',
    handle('portal:read_conditions', async (_ctx, req) => {
      const clause = await db.clause.findUnique({
        where: { ref: String(req.params.ref) },
        include: { insurer: { include: { clauses: true } } },
      });
      if (!clause) return { error: `No clause "${String(req.params.ref)}".`, status: 404 };
      const { insurer } = clause;
      const conditions: InsurerClauses = {
        insurer: { id: insurer.id, name: insurer.name, locale: insurer.locale as 'fr' | 'en' },
        clauses: insurer.clauses
          .sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }))
          .map((item) => ({
            ref: item.ref,
            title: item.title,
            text: item.text,
            general: item.general,
          })),
      };
      return { data: conditions };
    }),
  );

  return router;
}
