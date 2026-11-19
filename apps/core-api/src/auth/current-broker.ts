import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * V3 "authentication": the broker picked in the UI's selector, sent as `x-broker-id`. Real
 * sessions come in V10.
 */
export const BROKER_HEADER = 'x-broker-id';

export const CurrentBrokerId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const brokerId = request.get(BROKER_HEADER)?.trim();
  if (!brokerId) throw new UnauthorizedException(`Missing ${BROKER_HEADER} header.`);
  return brokerId;
});
