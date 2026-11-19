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
import { PROCESS_EMAIL_QUEUE, type ProcessEmailJob } from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(PROCESS_EMAIL_QUEUE) private readonly processEmailQueue: Queue<ProcessEmailJob>,
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
            attachments: {
              create: input.attachments.map((attachment, position) => ({
                fileName: attachment.fileName,
                type: attachment.contentType,
                extractedText: attachment.extractedText,
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
    this.realtime.publish('case.created', created.caseId, { reference });
    return { caseId: created.caseId, reference, created: true };
  }

  private async findByMessageId(
    messageId: string,
  ): Promise<{ caseId: string; reference: string } | null> {
    const email = await this.prisma.inboundEmail.findUnique({
      where: { messageId },
      include: { case: true },
    });
    if (!email?.case) return null;
    return { caseId: email.case.id, reference: caseReference(email.case.number) };
  }
}
