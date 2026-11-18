import { FileClaimInputSchema, FileClaimResultSchema } from '@demo/shared';
import { fromIsoDate, toIsoDate } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { defineTool, type ToolContext } from './define-tool.js';
import { findOwnPolicy } from './policy-access.js';

const MAX_NUMBER_ATTEMPTS = 3;

/** Next free claim number of the year: `S-2026-0413` after `S-2026-0412`. */
async function nextClaimNumber(ctx: ToolContext, year: string): Promise<string> {
  const prefix = `S-${year}-`;
  const numbers = await ctx.db.claim.findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  const max = Math.max(0, ...numbers.map(({ number }) => Number(number.slice(prefix.length)) || 0));
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export const fileClaim = defineTool({
  name: 'file_claim',
  description:
    'Declare a new claim to the insurer on one of your policies. Requires a write token. ' +
    'Only call it after a broker approved the declaration. Returns the claim number. ' +
    'Idempotent: filing the same claim again (same policy, date, peril and amount) returns the existing claim.',
  inputSchema: FileClaimInputSchema.shape,
  outputSchema: FileClaimResultSchema.shape,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, ctx) {
    const found = await findOwnPolicy(ctx, input.policyNumber, { coverages: true });
    if ('error' in found) return found;
    const { policy } = found;
    const date = fromIsoDate(input.date);

    if (
      policy.status !== 'active' ||
      date < policy.startDate ||
      (policy.endDate && date >= policy.endDate)
    ) {
      return {
        error:
          `The insurer refuses the declaration: policy ${policy.number} is ${policy.status}` +
          (policy.endDate ? ` since ${toIsoDate(policy.endDate)}` : '') +
          ` and does not cover an incident on ${input.date}. Check the policy with \`get_policy\`.`,
      };
    }
    if (!policy.coverages.some((coverage) => coverage.peril === input.nature)) {
      return {
        error: `Policy ${policy.number} has no coverage for "${input.nature}". Check the coverages with \`list_coverages\`.`,
      };
    }

    const amount = Math.round(input.amount);
    const existing = await ctx.db.claim.findFirst({
      where: { policyNumber: policy.number, date, nature: input.nature, amount },
    });
    if (existing) {
      return {
        data: {
          claimNumber: existing.number,
          policyNumber: policy.number,
          status: existing.status,
          alreadyFiled: true,
        },
      };
    }

    // Two concurrent declarations can compute the same number: retry on the unique constraint.
    for (let attempt = 1; ; attempt++) {
      const number = await nextClaimNumber(ctx, input.date.slice(0, 4));
      try {
        const claim = await ctx.db.claim.create({
          data: {
            number,
            policyNumber: policy.number,
            date,
            nature: input.nature,
            amount,
            status: 'open',
            description:
              input.description ?? `Filed by brokerage ${ctx.brokerCode} through the connector.`,
            documents: input.documents,
            filedBy: ctx.brokerCode,
          },
        });
        return {
          data: {
            claimNumber: claim.number,
            policyNumber: policy.number,
            status: 'open',
            alreadyFiled: false,
          },
        };
      } catch (error) {
        const conflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!conflict || attempt >= MAX_NUMBER_ATTEMPTS) throw error;
      }
    }
  },
});
