import type { Prisma } from '../generated/prisma/client.js';
import type { ToolContext } from './define-tool.js';

/**
 * Loads a policy of the calling brokerage. A policy of another brokerage is refused ("access
 * denied") rather than reported as missing, so the agent does not keep searching for it.
 */
export async function findOwnPolicy<Include extends Prisma.PolicyInclude>(
  ctx: ToolContext,
  number: string,
  include: Include,
): Promise<{ policy: Prisma.PolicyGetPayload<{ include: Include }> } | { error: string }> {
  const policy = await ctx.db.policy.findUnique({
    where: { number: number.trim().toUpperCase() },
    include,
  });
  if (!policy) {
    return {
      error: `No policy with number "${number}". Try \`search_policy\` with the holder's name.`,
    };
  }
  if (policy.brokerCode !== ctx.brokerCode) {
    return {
      error:
        `Access denied: policy "${policy.number}" is not managed by your brokerage (${ctx.brokerCode}). ` +
        "Do not retry with this number: check the policy number in the e-mail, or use `search_policy` with the holder's name.",
    };
  }
  return { policy };
}
