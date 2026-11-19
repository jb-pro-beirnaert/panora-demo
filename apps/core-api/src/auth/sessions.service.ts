import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './password.js';

export const SESSION_COOKIE = 'session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Returns a new session token, or null when the credentials are wrong. */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date } | null> {
    const broker = await this.prisma.broker.findUnique({ where: { email: email.toLowerCase() } });
    if (!broker || !(await verifyPassword(password, broker.passwordHash))) return null;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);
    await this.prisma.session.create({
      data: { tokenHash: hashToken(token), brokerId: broker.id, expiresAt },
    });
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<{ brokerId: string; brokerageId: string } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { broker: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return { brokerId: session.brokerId, brokerageId: session.broker.brokerageId };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
}

/** Reads one cookie from the raw header (no cookie-parser dependency). */
export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}
