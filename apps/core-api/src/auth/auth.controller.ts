import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ENV, type Env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentPrincipal, Public, type Principal } from './principal.js';
import { readCookie, SESSION_COOKIE, SessionsService } from './sessions.service.js';

const LoginSchema = z.object({ email: z.email(), password: z.string().min(1) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body({ schema: LoginSchema }) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.sessions.login(body.email, body.password);
    if (!session) throw new UnauthorizedException('Wrong e-mail or password.');
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.COOKIE_SECURE,
      expires: session.expiresAt,
      path: '/',
    });
    return { status: 'signed_in' };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req.get('cookie'), SESSION_COOKIE);
    if (token) await this.sessions.logout(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { status: 'signed_out' };
  }

  /** The signed-in broker and their brokerage. */
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    if (principal.kind !== 'broker') return { kind: 'admin' };
    const broker = await this.prisma.broker.findUniqueOrThrow({
      where: { id: principal.brokerId },
      include: { brokerage: true },
    });
    return {
      kind: 'broker',
      id: broker.id,
      name: broker.name,
      email: broker.email,
      preferredLocale: broker.preferredLocale,
      brokerage: {
        id: broker.brokerage.id,
        name: broker.brokerage.name,
        brokerCode: broker.brokerage.brokerCode,
      },
    };
  }

  /** Demo accounts shown on the sign-in page (demo mode only). */
  @Public()
  @Get('demo-accounts')
  async demoAccounts() {
    if (!this.env.DEMO_MODE) throw new NotFoundException();
    const brokers = await this.prisma.broker.findMany({
      include: { brokerage: true },
      orderBy: [{ brokerage: { name: 'asc' } }, { name: 'asc' }],
    });
    return {
      password: this.env.DEMO_BROKER_PASSWORD,
      accounts: brokers.map((broker) => ({
        email: broker.email,
        name: broker.name,
        brokerage: broker.brokerage.name,
      })),
    };
  }
}
