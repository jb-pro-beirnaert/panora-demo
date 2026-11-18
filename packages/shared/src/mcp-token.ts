import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { McpTokenScopeSchema } from './extranet-tools.js';

/**
 * Bearer tokens of the MCP extranet server: `mcp.<payload>.<signature>`, where the payload is the
 * base64url JSON `{ scope, brokerCode }` and the signature its HMAC-SHA256 with `MCP_TOKEN_SECRET`.
 *
 * The brokerage platform (the Mastra server here) holds the secret and issues one token per
 * brokerage and scope; the MCP server only verifies them. The token's `brokerCode` scopes every
 * tool to that brokerage's policies, so an agent cannot read another brokerage's data whatever its
 * prompt says, and only a `write` token can call `file_claim`.
 *
 * Node.js only (node:crypto): imported through `@demo/shared/mcp-token`, not the main entry.
 */

export const McpTokenClaimsSchema = z.object({
  scope: McpTokenScopeSchema,
  brokerCode: z.string().min(1),
});
export type McpTokenClaims = z.infer<typeof McpTokenClaimsSchema>;

const PREFIX = 'mcp';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueMcpToken(claims: McpTokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(McpTokenClaimsSchema.parse(claims))).toString(
    'base64url',
  );
  return `${PREFIX}.${payload}.${sign(payload, secret)}`;
}

/** The claims of a valid token, or null when the token is malformed or its signature is wrong. */
export function verifyMcpToken(token: string, secret: string): McpTokenClaims | null {
  const [prefix, payload, signature, ...rest] = token.split('.');
  if (prefix !== PREFIX || !payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = McpTokenClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
