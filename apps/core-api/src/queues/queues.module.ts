import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROCESS_EMAIL_QUEUE, RESUME_WORKFLOW_QUEUE } from './queue-names.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: 1_000,
  removeOnFail: 1_000,
};

/** Queue producers (registered once, shared by the modules that enqueue jobs). */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: PROCESS_EMAIL_QUEUE, defaultJobOptions },
      { name: RESUME_WORKFLOW_QUEUE, defaultJobOptions },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
