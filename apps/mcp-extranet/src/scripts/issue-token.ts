import { McpTokenScopeSchema } from '@demo/shared';
import { issueMcpToken } from '@demo/shared/mcp-token';

// Prints an MCP token, e.g. to try the server with the MCP inspector:
//   npm run token -w apps/mcp-extranet -- read DLM-075
const [scopeArg, brokerCode] = process.argv.slice(2);
const scope = McpTokenScopeSchema.safeParse(scopeArg);
const secret = process.env.MCP_TOKEN_SECRET;
if (!scope.success || !brokerCode || !secret) {
  console.error('Usage: npm run token -w apps/mcp-extranet -- <read|write> <brokerCode>');
  console.error('MCP_TOKEN_SECRET must be set (root .env).');
  process.exit(1);
}
console.log(issueMcpToken({ scope: scope.data, brokerCode }, secret));
