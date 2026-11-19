import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { assertBearer } from '../auth/bearer-token.guard.js';
import { ENV, type Env } from '../env.js';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    // The module is only registered with DEMO_MODE=true, which requires ADMIN_TOKEN.
    assertBearer(context.switchToHttp().getRequest<Request>(), this.env.ADMIN_TOKEN ?? '');
    return true;
  }
}
