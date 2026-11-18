import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from './define-tool.js';
import { fileClaim } from './file-claim.js';
import { getClaimHistory } from './get-claim-history.js';
import { getPolicy } from './get-policy.js';
import { listCoverages } from './list-coverages.js';
import { readClause } from './read-clause.js';
import { searchPolicy } from './search-policy.js';

/** Read tools for every token; `file_claim` only for `write` tokens (least privilege). */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, searchPolicy);
  registerTool(server, ctx, getPolicy);
  registerTool(server, ctx, listCoverages);
  registerTool(server, ctx, readClause);
  registerTool(server, ctx, getClaimHistory);
  if (ctx.scope === 'write') registerTool(server, ctx, fileClaim);
}
