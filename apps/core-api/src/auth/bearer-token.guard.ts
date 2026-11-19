import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/** Constant-time check of `Authorization: Bearer <expected>`. */
export function assertBearer(request: Request, expected: string): void {
  const received = Buffer.from(request.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${expected}`);
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
    throw new UnauthorizedException('A valid Bearer token is required.');
  }
}
