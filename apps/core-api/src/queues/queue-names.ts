import type { ApprovalDecision } from '@demo/shared';

export const PROCESS_EMAIL_QUEUE = 'process-email';
export const RESUME_WORKFLOW_QUEUE = 'resume-workflow';
/** Repeated maintenance jobs: stuck-case watchdog (V9), data purge (V10). */
export const MAINTENANCE_QUEUE = 'maintenance';

export interface ProcessEmailJob {
  caseId: string;
}

export interface ResumeWorkflowJob {
  caseId: string;
  workflowRunId: string;
  decision: ApprovalDecision;
}
