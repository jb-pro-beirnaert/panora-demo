import { extractAttachment } from '@demo/documents';
import { detectLanguage, type EmailAccepted, type ReceiveEmailRequest } from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { caseReference } from '../cases/case-views.js';
import { ENV, type Env } from '../env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PROCESS_EMAIL_QUEUE,
  type DraftReplyJob,
  type ProcessEmailJob,
} from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(PROCESS_EMAIL_QUEUE)
    private readonly processEmailQueue: Queue<ProcessEmailJob | DraftReplyJob>,
  ) {}

  /**
   * Stores the e-mail, opens a case and queues its processing. Idempotent on `messageId`: the same
   * e-mail received twice returns the existing case.
   */
  async receive({ runOptions, ...input }: ReceiveEmailRequest): Promise<EmailAccepted> {
    // Run options steer models and prompts: evals only, never in production.
    if (runOptions && !this.env.DEMO_MODE) {
      throw new BadRequestException('runOptions are only accepted in demo mode.');
    }
    const existing = await this.findByMessageId(input.messageId);
    if (existing) return { ...existing, created: false };

    const brokerage = await this.prisma.brokerage.findUnique({ where: { inboxEmail: input.to } });
    if (!brokerage) {
      throw new UnprocessableEntityException(`No brokerage has the inbox ${input.to}.`);
    }
    const client = await this.prisma.client.findFirst({
      where: { brokerageId: brokerage.id, email: { equals: input.from, mode: 'insensitive' } },
    });

    // V14: the agents only ever get text; the files stay in Core. Extraction runs before the
    // transaction (it can take a moment on a long PDF).
    const files = await Promise.all(
      input.attachments.map(async (attachment) => ({
        attachment,
        content: Buffer.from(attachment.contentBase64, 'base64'),
        extracted: await extractAttachment(attachment),
      })),
    );

    // V15: an answer to an e-mail of a case (In-Reply-To) joins that case instead of opening one.
    if (input.inReplyTo) {
      const thread = await this.findByMessageId(input.inReplyTo);
      if (thread) return this.attachFollowUp(thread, input, files, brokerage.locale);
    }

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const email = await tx.inboundEmail.create({
          data: {
            messageId: input.messageId,
            from: input.from,
            to: input.to,
            subject: input.subject,
            body: input.body,
            receivedAt: new Date(input.receivedAt),
            language: detectLanguage(`${input.subject}\n${input.body}`, brokerage.locale),
            inReplyTo: input.inReplyTo ?? null,
            attachments: {
              create: files.map(({ attachment, content, extracted }, position) => ({
                fileName: attachment.fileName,
                type: attachment.contentType,
                content,
                sizeBytes: extracted.sizeBytes,
                pageCount: extracted.pageCount,
                extractionStatus: extracted.extractionStatus,
                extractedText: extracted.extractedText,
                position,
              })),
            },
          },
        });
        const kase = await tx.case.create({
          data: {
            brokerageId: brokerage.id,
            emailId: email.id,
            clientId: client?.id ?? null,
            ...(runOptions ? { runOptions } : {}),
          },
        });
        await this.audit.record(
          {
            caseId: kase.id,
            actor: 'system',
            actorId: 'system',
            action: 'email_received',
            params: { from: input.from, subject: input.subject, clientFound: client !== null },
          },
          tx,
        );
        return { emailId: email.id, caseId: kase.id, number: kase.number };
      });
    } catch (error) {
      // Same e-mail received concurrently: the other request created the case.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findByMessageId(input.messageId);
        if (raced) return { ...raced, created: false };
      }
      throw error;
    }

    // Job id = e-mail id: a duplicate enqueue is a no-op in BullMQ.
    await this.processEmailQueue.add(
      'process-email',
      { caseId: created.caseId },
      { jobId: created.emailId },
    );
    const reference = caseReference(created.number);
    this.realtime.publish('case.created', created.caseId, { reference }, brokerage.id);
    return { caseId: created.caseId, reference, created: true };
  }

  private async findByMessageId(
    messageId: string,
  ): Promise<{ caseId: string; reference: string } | null> {
    const email = await this.prisma.inboundEmail.findUnique({
      where: { messageId },
      include: { case: true, followUpOf: true },
    });
    // V15: a follow-up e-mail belongs to the case it was attached to.
    const kase = email?.followUpOf ?? email?.case;
    if (!kase) return null;
    return { caseId: kase.id, reference: caseReference(kase.number) };
  }

  /**
   * V15: stores a follow-up e-mail on the case it answers, then asks the agents for a status reply
   * (`draft-reply` job). The case's own workflow is not touched.
   */
  private async attachFollowUp(
    thread: { caseId: string; reference: string },
    input: Omit<ReceiveEmailRequest, 'runOptions'>,
    files: {
      attachment: ReceiveEmailRequest['attachments'][number];
      content: Buffer<ArrayBuffer>;
      extracted: Awaited<ReturnType<typeof extractAttachment>>;
    }[],
    locale: 'fr' | 'en',
  ): Promise<EmailAccepted> {
    const email = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.inboundEmail.create({
        data: {
          messageId: input.messageId,
          from: input.from,
          to: input.to,
          subject: input.subject,
          body: input.body,
          receivedAt: new Date(input.receivedAt),
          language: detectLanguage(`${input.subject}\n${input.body}`, locale),
          inReplyTo: input.inReplyTo ?? null,
          followUpOfCaseId: thread.caseId,
          attachments: {
            create: files.map(({ attachment, content, extracted }, position) => ({
              fileName: attachment.fileName,
              type: attachment.contentType,
              content,
              sizeBytes: extracted.sizeBytes,
              pageCount: extracted.pageCount,
              extractionStatus: extracted.extractionStatus,
              extractedText: extracted.extractedText,
              position,
            })),
          },
        },
      });
      await this.audit.record(
        {
          caseId: thread.caseId,
          actor: 'system',
          actorId: 'system',
          action: 'follow_up_received',
          params: {
            from: input.from,
            subject: input.subject,
            attachments: files.length,
          },
        },
        tx,
      );
      return stored;
    });
    const job: DraftReplyJob = { caseId: thread.caseId, kind: 'send_status', emailId: email.id };
    await this.processEmailQueue.add('draft-reply', job, { jobId: `reply-${email.id}` });
    const kase = await this.prisma.case.findUnique({ where: { id: thread.caseId } });
    if (kase) {
      this.realtime.publish('case.updated', kase.id, { followUp: true }, kase.brokerageId);
    }
    return { ...thread, created: false };
  }
}
