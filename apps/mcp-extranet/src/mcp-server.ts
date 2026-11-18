import type { McpTokenClaims } from '@demo/shared/mcp-token';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from './db.js';
import { registerTools } from './tools/index.js';

/** One MCP server per HTTP request (stateless Streamable HTTP), scoped to the caller's token. */
export function createMcpServer(db: Db, claims: McpTokenClaims): McpServer {
  const server = new McpServer(
    { name: 'insurer-extranet', version: '2.0.0' },
    {
      instructions:
        `Simulated extranet of the insurers, for brokerage ${claims.brokerCode}. ` +
        "Read your brokerage's policies, coverages, clauses and claim history" +
        (claims.scope === 'write' ? ', and declare claims.' : '.') +
        " The insurer's data is authoritative: it can differ from what the brokerage believes.",
    },
  );
  registerTools(server, { db, brokerCode: claims.brokerCode, scope: claims.scope });
  return server;
}
