import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
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
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'watchdog',
      { every: WATCHDOG_EVERY_MS },
      { name: 'watchdog' },
    );
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'watchdog') return this.watchdog.run();
    return null;
  }
}
