import { z } from 'zod';
import { defineTool } from './define-tool.js';

export const readClause = defineTool({
  name: 'read_clause',
  description:
    'Read the exact text of a clause of the insurer\'s general conditions, by reference (e.g. "CG-HZ-4.2"). ' +
    'References come from `list_coverages` (clauseRef) and `get_policy` (generalClauses). Quote clauses verbatim from this text.',
  inputSchema: {
    ref: z.string().trim().min(1).describe('Clause reference, e.g. "CG-HZ-4.2".'),
  },
  // Clauses are the insurer's general conditions, shared by all its policies: not brokerage-scoped.
  async handler({ ref }, { db }) {
    const normalized = ref.toUpperCase();
    const clause = await db.clause.findUnique({
      where: { ref: normalized },
      include: { insurer: true },
    });
    if (!clause) {
      const prefix = normalized.split('-').slice(0, 2).join('-');
      const siblings = await db.clause.findMany({
        where: { ref: { startsWith: `${prefix}-` } },
        select: { ref: true, title: true },
        orderBy: { ref: 'asc' },
      });
      return {
        error:
          `No clause with reference "${ref}". ` +
          (siblings.length > 0
            ? `Clauses of this insurer: ${siblings.map((s) => `${s.ref} (${s.title})`).join(', ')}.`
            : 'Get valid references from `list_coverages` or `get_policy`.'),
      };
    }
    return {
      data: {
        ref: clause.ref,
        insurer: clause.insurer.name,
        title: clause.title,
        text: clause.text,
      },
    };
  },
});
