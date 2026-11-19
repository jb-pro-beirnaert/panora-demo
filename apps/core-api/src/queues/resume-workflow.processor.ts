import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { MastraClient } from '../mastra-client/mastra-client.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RESUME_WORKFLOW_QUEUE, type ResumeWorkflowJob } from './queue-names.js';

/** Resumes the suspended workflow with the broker's decision, without waiting for it. */
@Processor(RESUME_WORKFLOW_QUEUE)
export class ResumeWorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(ResumeWorkflowProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mastra: MastraClient,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<ResumeWorkflowJob>): Promise<void> {
    const { caseId, workflowRunId, decision } = job.data;
    if ((await this.prisma.case.count({ where: { id: caseId } })) === 0) {
      this.logger.warn(`case ${caseId} no longer exists (reset?): job skipped`);
      return;
    }
    await this.mastra.resume(workflowRunId, decision);
    await this.audit.record({
      caseId,
      actor: 'system',
      actorId: 'system',
      action: 'workflow_resumed',
      params: { workflowRunId, approved: decision.approved },
    });
  }
}
