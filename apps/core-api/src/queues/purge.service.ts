import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ENV, type Env } from '../env.js';
import { MastraClient } from '../mastra-client/mastra-client.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BATCH = 200;

/**
 * Retention (V10): once a case has been closed for RETENTION_DAYS, the technical copies of its data
 * — the workflow snapshot (prompts' inputs, e-mail, drafts) in the Mastra database and the
 * Langfuse trace — are deleted. Core keeps the case and its append-only audit trail.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mastra: MastraClient,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(now = new Date()): Promise<{ cases: number; runs: number; traces: number }> {
    const before = new Date(now.getTime() - this.env.RETENTION_DAYS * 86_400_000);
    const cases = await this.prisma.case.findMany({
      where: {
        status: { in: ['classified', 'claim_filed', 'ready_to_send'] },
        updatedAt: { lt: before },
        purgedAt: null,
        workflowRunId: { not: null },
      },
      take: BATCH,
    });
    if (cases.length === 0) return { cases: 0, runs: 0, traces: 0 };
    const result = await this.mastra.purge(
      cases.map((kase) => kase.workflowRunId!),
      cases.flatMap((kase) => (kase.traceId ? [kase.traceId] : [])),
    );
    await this.prisma.case.updateMany({
      where: { id: { in: cases.map((kase) => kase.id) } },
      data: { purgedAt: now },
    });
    for (const kase of cases) {
      await this.audit.record({
        caseId: kase.id,
        actor: 'system',
        actorId: 'retention',
        action: 'data_purged',
        params: { retentionDays: this.env.RETENTION_DAYS },
      });
    }
    this.logger.log(`purged ${cases.length} cases: ${JSON.stringify(result)}`);
    return { cases: cases.length, ...result };
  }
}
