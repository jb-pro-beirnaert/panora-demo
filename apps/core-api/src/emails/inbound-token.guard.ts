import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { assertBearer } from '../auth/bearer-token.guard.js';
import { ENV, type Env } from '../env.js';

/** `POST /emails`: only the inbound e-mail gateway (the simulator in the demo). */
@Injectable()
export class InboundTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    assertBearer(context.switchToHttp().getRequest<Request>(), this.env.INBOUND_EMAIL_TOKEN);
    return true;
  }
}
