import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../env.js';
import { PurgeService } from './purge.service.js';
import type { OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from './queue-names.js';
import { WatchdogService } from './watchdog.service.js';

export const WATCHDOG_EVERY_MS = 30_000;

/** Repeated maintenance jobs (one scheduler per job: a single run at a time across instances). */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly watchdog: WatchdogService,
    private readonly purge: PurgeService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'watchdog',
      { every: WATCHDOG_EVERY_MS },
      { name: 'watchdog' },
    );
    await this.queue.upsertJobScheduler(
      'purge',
      { every: this.env.PURGE_EVERY_MS },
      { name: 'purge' },
    );
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'watchdog') return this.watchdog.run();
    if (job.name === 'purge') return this.purge.run();
    return null;
  }
}
