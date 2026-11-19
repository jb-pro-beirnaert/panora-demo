import type { AuditAction, AuditActor } from '@demo/shared';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  caseId: string | null;
  actor: AuditActor;
  actorId: string;
  action: AuditAction;
  params?: Prisma.InputJsonObject;
  source?: string | null;
}

type Tx = Pick<PrismaService, 'auditLog'>;

/**
 * Business audit trail. Append-only by design: this service only creates rows, and no route
 * updates or deletes them (a demo reset wipes the whole database).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        caseId: entry.caseId,
        actor: entry.actor,
        actorId: entry.actorId,
        action: entry.action,
        params: entry.params ?? {},
        source: entry.source ?? null,
      },
    });
  }
}
