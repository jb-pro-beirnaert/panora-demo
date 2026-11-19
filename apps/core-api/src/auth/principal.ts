import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Who is calling the public API (V10):
 * - a signed-in broker: every read and write is limited to their brokerage;
 * - the demo admin (simulator, evals, load tests; Bearer ADMIN_TOKEN, demo mode only): sees every
 *   brokerage and decides on behalf of a broker named in `x-broker-id`.
 */
export type Principal =
  { kind: 'broker'; brokerId: string; brokerageId: string } | { kind: 'admin' };

export type AuthenticatedRequest = Request & { principal?: Principal };

/** Header naming the broker the demo admin acts for (simulated broker). */
export const ACT_AS_BROKER_HEADER = 'x-broker-id';

export const IS_PUBLIC = 'isPublic';
/** Skips the session guard (health, login; internal, admin and inbound routes have their own). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const principal = ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a public route');
  return principal;
});

/** Brokerage filter of a Prisma query: none for the admin. */
export function brokerageScope(principal: Principal): { brokerageId?: string } {
  return principal.kind === 'broker' ? { brokerageId: principal.brokerageId } : {};
}
