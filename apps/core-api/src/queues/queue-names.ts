import type { ApprovalDecision } from '@demo/shared';

export const PROCESS_EMAIL_QUEUE = 'process-email';
export const RESUME_WORKFLOW_QUEUE = 'resume-workflow';
/** Repeated maintenance jobs: stuck-case watchdog (V9), data purge (V10). */
export const MAINTENANCE_QUEUE = 'maintenance';

export interface ProcessEmailJob {
  caseId: string;
}

/**
 * V15, job `draft-reply` of the process-email queue: a standalone reply (case status after a
 * follow-up, acknowledgement), drafted by the Mastra workflow `draft-reply`.
 */
export interface DraftReplyJob {
  caseId: string;
  kind: 'send_status' | 'acknowledge';
  /** The e-mail the reply answers. */
  emailId: string;
  /** The rejected reply and the broker's comment, for a re-draft. */
  previous?: { subject: string; body: string; comment: string | null };
}

export interface ResumeWorkflowJob {
  caseId: string;
  workflowRunId: string;
  decision: ApprovalDecision;
}
