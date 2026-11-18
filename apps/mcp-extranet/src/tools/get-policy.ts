import { z } from 'zod';
import { toIsoDate } from '../db.js';
import { defineTool } from './define-tool.js';

export const getPolicy = defineTool({
  name: 'get_policy',
  description:
    'Get a policy as the insurer currently sees it: status (active, suspended, terminated), start and end dates, end reason, product, holder. ' +
    "The insurer's status is authoritative and may differ from what the brokerage believes. " +
    'Also lists the general clauses of the policy (declaration delay, supporting documents, termination…): read them with `read_clause`.',
  inputSchema: {
    number: z.string().trim().min(1).describe('Exact policy number, e.g. "C-48213".'),
  },
  async handler({ number }, { db }) {
    const policy = await db.policy.findUnique({
      where: { number: number.toUpperCase() },
      include: { insurer: { include: { clauses: { where: { general: true } } } } },
    });
    if (!policy) {
      return {
        error: `No policy with number "${number}". Try \`search_policy\` with the holder's name.`,
      };
    }
    return {
      data: {
        number: policy.number,
        insurer: policy.insurer.name,
        holderName: policy.holderName,
        holderSiren: policy.holderSiren,
        product: policy.product,
        status: policy.status,
        startDate: toIsoDate(policy.startDate),
        endDate: policy.endDate ? toIsoDate(policy.endDate) : null,
        endReason: policy.endReason,
        generalClauses: policy.insurer.clauses
          .sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }))
          .map((clause) => ({ ref: clause.ref, title: clause.title })),
      },
    };
  },
});
