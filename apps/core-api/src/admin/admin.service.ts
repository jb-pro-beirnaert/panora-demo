import type { CoreSeed } from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PROCESS_EMAIL_QUEUE,
  RESUME_WORKFLOW_QUEUE,
  type ProcessEmailJob,
  type ResumeWorkflowJob,
} from '../queues/queue-names.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const TABLES = [
  'AuditLog',
  'ProposedAction',
  'AgentStep',
  'AgentEvent',
  'Case',
  'Attachment',
  'InboundEmail',
  'Policy',
  'Client',
  'Broker',
  'Brokerage',
];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(PROCESS_EMAIL_QUEUE) private readonly processEmailQueue: Queue<ProcessEmailJob>,
    @InjectQueue(RESUME_WORKFLOW_QUEUE) private readonly resumeQueue: Queue<ResumeWorkflowJob>,
  ) {}

  /** Empties every table (case numbers restart at 1) and both queues, then tells the UI. */
  async reset(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    for (const queue of [this.processEmailQueue, this.resumeQueue]) {
      await queue.obliterate({ force: true });
    }
    this.realtime.publish('demo.reset', null);
  }

  async seed(world: CoreSeed): Promise<Record<string, number>> {
    await this.reset();
    await this.prisma.$transaction([
      this.prisma.brokerage.createMany({ data: world.brokerages }),
      this.prisma.broker.createMany({
        data: world.brokers.map((broker) => ({ ...broker, email: broker.email.toLowerCase() })),
      }),
      this.prisma.client.createMany({ data: world.clients }),
      this.prisma.policy.createMany({
        data: world.policies.map((policy) => ({
          ...policy,
          renewalDate: new Date(`${policy.renewalDate}T00:00:00.000Z`),
        })),
      }),
    ]);
    return {
      brokerages: world.brokerages.length,
      brokers: world.brokers.length,
      clients: world.clients.length,
      policies: world.policies.length,
    };
  }
}
