import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from './define-tool.js';
import { getClaimHistory } from './get-claim-history.js';
import { getPolicy } from './get-policy.js';
import { listCoverages } from './list-coverages.js';
import { readClause } from './read-clause.js';
import { searchPolicy } from './search-policy.js';

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, searchPolicy);
  registerTool(server, ctx, getPolicy);
  registerTool(server, ctx, listCoverages);
  registerTool(server, ctx, readClause);
  registerTool(server, ctx, getClaimHistory);
}
