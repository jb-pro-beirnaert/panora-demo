import type { CoreSeed } from '@demo/shared';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hashPassword } from '../auth/password.js';
import { ENV, type Env } from '../env.js';
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
  'Session',
  'Broker',
  'Brokerage',
];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(ENV) private readonly env: Env,
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
    const passwordHash = await hashPassword(this.env.DEMO_BROKER_PASSWORD);
    await this.prisma.$transaction([
      this.prisma.brokerage.createMany({ data: world.brokerages }),
      // Demo accounts: every seeded broker signs in with DEMO_BROKER_PASSWORD.
      this.prisma.broker.createMany({
        data: world.brokers.map((broker) => ({
          ...broker,
          email: broker.email.toLowerCase(),
          passwordHash,
        })),
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
