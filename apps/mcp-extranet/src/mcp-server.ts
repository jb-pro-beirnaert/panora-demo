import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from './db.js';
import { registerReadTools } from './tools/index.js';

/** One MCP server per HTTP request (stateless Streamable HTTP). */
export function createMcpServer(db: Db): McpServer {
  const server = new McpServer(
    { name: 'insurer-extranet', version: '1.0.0' },
    {
      instructions:
        'Simulated extranet of the insurers. Read policies, coverages, clauses and claim history. ' +
        "The insurer's data is authoritative: it can differ from what the brokerage believes.",
    },
  );
  registerReadTools(server, { db, brokerCode: null });
  return server;
}
