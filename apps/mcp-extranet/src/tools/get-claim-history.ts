import { z } from 'zod';
import { toIsoDate } from '../db.js';
import { defineTool } from './define-tool.js';

export const getClaimHistory = defineTool({
  name: 'get_claim_history',
  description:
    'List the claims already declared on a policy (number, incident date, peril, amount in euros, status, description), most recent first. ' +
    'Use it to detect a claim that was already declared (same date and peril).',
  inputSchema: {
    policyNumber: z.string().trim().min(1).describe('Exact policy number, e.g. "F-77102".'),
  },
  async handler({ policyNumber }, { db }) {
    const policy = await db.policy.findUnique({
      where: { number: policyNumber.toUpperCase() },
      include: { claims: { orderBy: { date: 'desc' } } },
    });
    if (!policy) {
      return {
        error: `No policy with number "${policyNumber}". Try \`search_policy\` with the holder's name.`,
      };
    }
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
