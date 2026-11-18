import { z } from 'zod';
import { defineTool } from './define-tool.js';

export const listCoverages = defineTool({
  name: 'list_coverages',
  description:
    'List the coverages of a policy: peril, label, limit and deductible (in euros), excluded causes, and the reference of the clause that defines each coverage. ' +
    'Read the clause with `read_clause` before concluding that a claim is covered or excluded.',
  inputSchema: {
    policyNumber: z.string().trim().min(1).describe('Exact policy number, e.g. "C-48213".'),
  },
  async handler({ policyNumber }, { db }) {
    const policy = await db.policy.findUnique({
      where: { number: policyNumber.toUpperCase() },
      include: { coverages: { orderBy: { id: 'asc' } } },
    });
    if (!policy) {
      return {
        error: `No policy with number "${policyNumber}". Try \`search_policy\` with the holder's name.`,
      };
    }
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
