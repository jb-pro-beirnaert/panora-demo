import { RunOptionsSchema, type InboundEmailInput, type ProcessEmailInput } from '@demo/shared';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { caseTracing, MastraClient } from '../mastra-client/mastra-client.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { caseReference } from '../cases/case-views.js';
import { PROCESS_EMAIL_QUEUE, type DraftReplyJob, type ProcessEmailJob } from './queue-names.js';
import { workerOptions } from './worker-options.js';

/**
 * Starts the Mastra workflow of a case and returns at once: it never waits for the workflow,
 * whose progress comes back through the `/internal/*` callbacks.
 */
@Processor(PROCESS_EMAIL_QUEUE, workerOptions())
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

  async process(
    job: Job<ProcessEmailJob | DraftReplyJob>,
  ): Promise<{ workflowRunId: string } | null> {
    if (job.name === 'draft-reply') return this.draftReply(job.data as DraftReplyJob);
    const kase = await this.prisma.case.findUnique({
      where: { id: job.data.caseId },
      include: {
        brokerage: true,
        email: {
          include: { attachments: { orderBy: { position: 'asc' }, omit: { content: true } } },
        },
        // V15: documents sent later in follow-ups are analysed with the case (re-analysis).
        followUps: {
          orderBy: { receivedAt: 'asc' },
          include: { attachments: { orderBy: { position: 'asc' }, omit: { content: true } } },
        },
      },
    });
    if (!kase) {
      this.logger.warn(`case ${job.data.caseId} no longer exists (reset?): job skipped`);
      return null;
    }
    // A retried or duplicated job must not start a second run: the case is claimed atomically
    // (only one job can move it from `received` to `processing`).
    if (kase.workflowRunId) return { workflowRunId: kase.workflowRunId };
    const claimed = await this.prisma.case.updateMany({
      where: { id: kase.id, status: 'received', workflowRunId: null },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) return null;

    const input: ProcessEmailInput = {
      caseId: kase.id,
      email: {
        messageId: kase.email.messageId,
        from: kase.email.from,
        to: kase.email.to,
        subject: kase.email.subject,
        body: kase.email.body,
        receivedAt: kase.email.receivedAt.toISOString(),
        attachments: [
          ...kase.email.attachments,
          ...kase.followUps.flatMap((followUp) => followUp.attachments),
        ].map((attachment) => ({
          fileName: attachment.fileName,
          contentType: attachment.type,
          extractedText: attachment.extractedText,
        })),
      },
      brokerage: { brokerCode: kase.brokerage.brokerCode, locale: kase.brokerage.locale },
      ...(kase.runOptions ? { options: RunOptionsSchema.parse(kase.runOptions) } : {}),
    };

    // The run id is stored before the run starts, so no callback can precede it.
    let workflowRunId: string;
    try {
      workflowRunId = await this.mastra.createRun();
    } catch (error) {
      // Give the case back, so the job's retry (or the watchdog) can claim it again.
      await this.prisma.case.update({ where: { id: kase.id }, data: { status: 'received' } });
      throw error;
    }
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
    this.realtime.publish('case.updated', kase.id, { status: 'processing' }, kase.brokerageId);
    return { workflowRunId };
  }

  /**
   * V15: a standalone reply — the status of the case after a follow-up, or an acknowledgement —
   * drafted by the Mastra workflow `draft-reply`. The case's own run is not touched.
   */
  private async draftReply(job: DraftReplyJob): Promise<{ workflowRunId: string } | null> {
    const kase = await this.prisma.case.findUnique({
      where: { id: job.caseId },
      include: {
        brokerage: true,
        client: true,
        proposedActions: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });
    const email = await this.prisma.inboundEmail.findUnique({
      where: { id: job.emailId },
      include: { attachments: { orderBy: { position: 'asc' }, omit: { content: true } } },
    });
    if (!kase || !email) {
      this.logger.warn(`case ${job.caseId} no longer exists (reset?): reply skipped`);
      return null;
    }
    const input = {
      caseId: kase.id,
      kind: job.kind,
      email: {
        messageId: email.messageId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        receivedAt: email.receivedAt.toISOString(),
        attachments: email.attachments.map((attachment) => ({
          fileName: attachment.fileName,
          contentType: attachment.type,
          extractedText: attachment.extractedText,
        })),
      } satisfies InboundEmailInput,
      brokerage: { brokerCode: kase.brokerage.brokerCode, locale: kase.brokerage.locale },
      // What the brokerage knows about the case: the agent tells the client where it stands.
      caseContext: JSON.stringify(
        {
          reference: caseReference(kase.number),
          receivedAt: kase.createdAt.toISOString().slice(0, 10),
          client: kase.client?.companyName ?? null,
          requestType: kase.requestType,
          status: kase.status,
          policyNumber: kase.policyNumber,
          verdict: kase.verdict,
          alerts: kase.alerts,
          claimNumber: kase.claimNumber,
          handoverReason: kase.handoverReason,
          proposals: kase.proposedActions.map((action) => ({
            actionType: action.actionType,
            status: action.status,
            subject: action.finalDraftSubject ?? action.draftSubject,
          })),
          documentsReceivedInThisEmail: email.attachments.map((attachment) => attachment.fileName),
        },
        null,
        2,
      ),
      ...(job.previous ? { previous: job.previous } : {}),
    };
    const workflowRunId = await this.mastra.startDraftReply(
      input,
      caseTracing(kase.id, { brokerCode: kase.brokerage.brokerCode }),
    );
    await this.audit.record({
      caseId: kase.id,
      actor: 'system',
      actorId: 'system',
      action: 'workflow_started',
      params: { workflowRunId, workflow: 'draft-reply', kind: job.kind },
    });
    return { workflowRunId };
  }
}
