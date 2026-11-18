import { z } from 'zod';
import { normalizeName } from '../db.js';
import { defineTool } from './define-tool.js';

const MAX_RESULTS = 10;

export const searchPolicy = defineTool({
  name: 'search_policy',
  description:
    "Find your brokerage's insurance policies at the insurer, by exact policy number or by (part of) the policy holder name. " +
    'Use it when the e-mail gives no policy number, or when `get_policy` does not find the number. ' +
    'Returns a short list; call `get_policy` on the right one for details.',
  inputSchema: {
    number: z.string().trim().min(1).optional().describe('Exact policy number, e.g. "C-48213".'),
    holderName: z
      .string()
      .trim()
      .min(2)
      .optional()
      .describe(
        'Company name of the policy holder, or a distinctive part of it, e.g. "Boulangerie Martin".',
      ),
  },
  async handler({ number, holderName }, { db, brokerCode }) {
    if (!number && !holderName) {
      return { error: 'Provide `number` or `holderName`.' };
    }
    const policies = await db.policy.findMany({
      where: {
        brokerCode,
        ...(number ? { number: number.toUpperCase() } : {}),
        ...(holderName ? { holderNameSearch: { contains: normalizeName(holderName) } } : {}),
      },
      include: { insurer: true },
      orderBy: { number: 'asc' },
      take: MAX_RESULTS + 1,
    });
    if (policies.length === 0) {
      return {
        data: {
          policies: [],
          hint: holderName
            ? 'No policy matches this holder name. Retry with a shorter, distinctive part of the name (e.g. the family name), without the legal form (SARL, SAS…).'
            : 'No policy has this number. Retry with `holderName` (the company name from the e-mail signature or sender domain).',
        },
      };
    }
    return {
      data: {
        policies: policies.slice(0, MAX_RESULTS).map((policy) => ({
          number: policy.number,
          holderName: policy.holderName,
          insurer: policy.insurer.name,
          product: policy.product,
          status: policy.status,
        })),
        ...(policies.length > MAX_RESULTS
          ? { hint: `More than ${MAX_RESULTS} results: refine \`holderName\`.` }
          : {}),
      },
    };
  },
});
