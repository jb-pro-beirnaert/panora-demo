import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/** Constant-time comparison of `Authorization: Bearer <expected>`. */
export function hasBearer(request: Request, expected: string): boolean {
  const received = Buffer.from(request.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${expected}`);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

/** Throws unless the request carries `Authorization: Bearer <expected>`. */
export function assertBearer(request: Request, expected: string): void {
  if (!hasBearer(request, expected)) {
    throw new UnauthorizedException('A valid Bearer token is required.');
  }
}
