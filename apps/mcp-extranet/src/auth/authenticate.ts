import { verifyMcpToken, type McpTokenClaims } from '@demo/shared/mcp-token';
import type { Request } from 'express';

/** Claims of the request's `Authorization: Bearer <token>`, or null when absent or invalid. */
export function authenticate(req: Request, secret: string): McpTokenClaims | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  return match?.[1] ? verifyMcpToken(match[1], secret) : null;
}
