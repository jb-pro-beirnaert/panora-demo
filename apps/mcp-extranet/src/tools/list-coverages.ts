import { z } from 'zod';
import { defineTool } from './define-tool.js';
import { findOwnPolicy } from './policy-access.js';

export const listCoverages = defineTool({
  name: 'list_coverages',
  description:
    'List the coverages of a policy: peril, label, limit and deductible (in euros), excluded causes, and the reference of the clause that defines each coverage. ' +
    'Read the clause with `read_clause` before concluding that a claim is covered or excluded.',
  inputSchema: {
    policyNumber: z.string().trim().min(1).describe('Exact policy number, e.g. "C-48213".'),
  },
  async handler({ policyNumber }, ctx) {
    const found = await findOwnPolicy(ctx, policyNumber, {
      coverages: { orderBy: { id: 'asc' } },
    });
    if ('error' in found) return found;
    const { policy } = found;
    return {
      data: {
        policyNumber: policy.number,
        currency: 'EUR',
        coverages: policy.coverages.map((coverage) => ({
          peril: coverage.peril,
          label: coverage.label,
          limit: coverage.limit,
          deductible: coverage.deductible,
          exclusions: coverage.exclusions,
          clauseRef: coverage.clauseRef,
        })),
      },
    };
  },
});
