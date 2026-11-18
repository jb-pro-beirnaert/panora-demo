import { z } from 'zod';
import { toIsoDate } from '../db.js';
import { defineTool } from './define-tool.js';
import { findOwnPolicy } from './policy-access.js';

export const getClaimHistory = defineTool({
  name: 'get_claim_history',
  description:
    'List the claims already declared on a policy (number, incident date, peril, amount in euros, status, description), most recent first. ' +
    'Use it to detect a claim that was already declared (same date and peril).',
  inputSchema: {
    policyNumber: z.string().trim().min(1).describe('Exact policy number, e.g. "F-77102".'),
  },
  async handler({ policyNumber }, ctx) {
    const found = await findOwnPolicy(ctx, policyNumber, {
      claims: { orderBy: [{ date: 'desc' }, { number: 'desc' }] },
    });
    if ('error' in found) return found;
    const { policy } = found;
    return {
      data: {
        policyNumber: policy.number,
        claims: policy.claims.map((claim) => ({
          number: claim.number,
          date: toIsoDate(claim.date),
          nature: claim.nature,
          amount: claim.amount,
          status: claim.status,
          description: claim.description,
        })),
      },
    };
  },
});
