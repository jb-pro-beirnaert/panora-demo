import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { ENV, type Env } from '../env.js';
import { IS_PUBLIC, type AuthenticatedRequest } from './principal.js';
import { readCookie, SESSION_COOKIE, SessionsService } from './sessions.service.js';

const sameToken = (received: string, expected: string) => {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Global guard of the public API: a broker session (cookie), or the admin token in demo mode. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const bearer = request.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (
      bearer &&
      this.env.DEMO_MODE &&
      this.env.ADMIN_TOKEN &&
      sameToken(bearer, this.env.ADMIN_TOKEN)
    ) {
      request.principal = { kind: 'admin' };
      return true;
    }
    const token = readCookie(request.get('cookie'), SESSION_COOKIE);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw new UnauthorizedException('Sign in first.');
    request.principal = { kind: 'broker', ...session };
    return true;
  }
}
