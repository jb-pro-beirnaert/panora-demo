import { RequestCancellationInputSchema, RequestCancellationResultSchema } from '@demo/shared';
import { fromIsoDate, toIsoDate } from '../db.js';
import { defineTool } from './define-tool.js';
import { findOwnPolicy } from './policy-access.js';

/** Renewal dates of a policy from `renewalDate` on (one per year). */
function isRenewalDate(renewal: Date, candidate: Date): boolean {
  return (
    candidate >= renewal &&
    candidate.getUTCMonth() === renewal.getUTCMonth() &&
    candidate.getUTCDate() === renewal.getUTCDate()
  );
}

export const requestCancellation = defineTool({
  name: 'request_cancellation',
  description:
    "Record the client's cancellation of one of your policies at the insurer (V15). Requires a write token. " +
    'Only call it after a broker approved the cancellation. The policy stays active until effectiveDate, which must be a renewal date (see `get_policy`). ' +
    'Idempotent: recording the same cancellation again returns alreadyRequested: true.',
  inputSchema: RequestCancellationInputSchema.shape,
  outputSchema: RequestCancellationResultSchema.shape,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, ctx) {
    const found = await findOwnPolicy(ctx, input.policyNumber, {});
    if ('error' in found) return found;
    const { policy } = found;
    const effective = fromIsoDate(input.effectiveDate);
    if (policy.status === 'terminated') {
      return {
        error: `The insurer refuses: policy ${policy.number} is already terminated${policy.endDate ? ` since ${toIsoDate(policy.endDate)}` : ''}. Check it with \`get_policy\`.`,
      };
    }
    if (policy.endReason === 'client_request' && policy.endDate) {
      if (policy.endDate.getTime() === effective.getTime()) {
        return {
          data: {
            policyNumber: policy.number,
            effectiveDate: input.effectiveDate,
            alreadyRequested: true,
          },
        };
      }
      return {
        error: `A cancellation of policy ${policy.number} is already scheduled for ${toIsoDate(policy.endDate)}.`,
      };
    }
    if (!isRenewalDate(policy.renewalDate, effective)) {
      return {
        error: `The insurer refuses: ${input.effectiveDate} is not a renewal date of policy ${policy.number} (next renewal: ${toIsoDate(policy.renewalDate)}).`,
      };
    }
    await ctx.db.policy.update({
      where: { number: policy.number },
      data: {
        endDate: effective,
        endReason: 'client_request',
        cancellationRequestedAt: new Date(),
      },
    });
    return {
      data: {
        policyNumber: policy.number,
        effectiveDate: input.effectiveDate,
        alreadyRequested: false,
      },
    };
  },
});
