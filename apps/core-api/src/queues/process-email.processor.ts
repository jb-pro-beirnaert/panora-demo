import { RunOptionsSchema, type ProcessEmailInput } from '@demo/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { caseTracing, MastraClient } from '../mastra-client/mastra-client.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PROCESS_EMAIL_QUEUE, type ProcessEmailJob } from './queue-names.js';

/**
 * Starts the Mastra workflow of a case and returns at once: it never waits for the workflow,
 * whose progress comes back through the `/internal/*` callbacks.
 */
@Processor(PROCESS_EMAIL_QUEUE)
export class ProcessEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(ProcessEmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mastra: MastraClient,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<ProcessEmailJob>): Promise<{ workflowRunId: string } | null> {
    const kase = await this.prisma.case.findUnique({
      where: { id: job.data.caseId },
      include: {
        brokerage: true,
        email: { include: { attachments: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!kase) {
      this.logger.warn(`case ${job.data.caseId} no longer exists (reset?): job skipped`);
      return null;
    }
    // A retried job after a successful start must not start a second run.
    if (kase.workflowRunId) return { workflowRunId: kase.workflowRunId };

    const input: ProcessEmailInput = {
      caseId: kase.id,
      email: {
        messageId: kase.email.messageId,
        from: kase.email.from,
        to: kase.email.to,
        subject: kase.email.subject,
        body: kase.email.body,
        receivedAt: kase.email.receivedAt.toISOString(),
        attachments: kase.email.attachments.map((attachment) => ({
          fileName: attachment.fileName,
          contentType: attachment.type,
          extractedText: attachment.extractedText,
        })),
      },
      brokerage: { brokerCode: kase.brokerage.brokerCode, locale: kase.brokerage.locale },
      ...(kase.runOptions ? { options: RunOptionsSchema.parse(kase.runOptions) } : {}),
    };

    // The run id is stored before the run starts, so no callback can precede it.
    const workflowRunId = await this.mastra.createRun();
    const tracing = caseTracing(kase.id, {
      brokerCode: kase.brokerage.brokerCode,
      emailLanguage: kase.email.language,
    });
    await this.prisma.case.update({
      where: { id: kase.id },
      data: { workflowRunId, traceId: tracing.traceId, status: 'processing' },
    });
    await this.mastra.start(workflowRunId, input, tracing);
    await this.audit.record({
      caseId: kase.id,
      actor: 'system',
      actorId: 'system',
      action: 'workflow_started',
      params: { workflowRunId },
    });
    this.realtime.publish('case.updated', kase.id, { status: 'processing' });
    return { workflowRunId };
  }
}
