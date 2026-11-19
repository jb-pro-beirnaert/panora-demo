import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { assertBearer } from '../auth/bearer-token.guard.js';
import { ENV, type Env } from '../env.js';

/** `/internal/*`: only the Mastra server, with the service token. */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    assertBearer(context.switchToHttp().getRequest<Request>(), this.env.CORE_SERVICE_TOKEN);
    return true;
  }
}
