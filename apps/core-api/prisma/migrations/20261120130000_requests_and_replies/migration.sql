-- V15: every request type, replies to the client, "À traiter par vous", follow-ups.
ALTER TYPE "CaseStatus" ADD VALUE 'needs_broker';
ALTER TYPE "CaseStatus" ADD VALUE 'handled_manually';
ALTER TYPE "CaseStatus" ADD VALUE 'cancellation_filed';
ALTER TYPE "CaseStatus" ADD VALUE 'merged';
ALTER TYPE "ActionType" ADD VALUE 'cancel_policy';
ALTER TYPE "ActionType" ADD VALUE 'answer_question';
ALTER TYPE "ActionType" ADD VALUE 'send_status';
ALTER TYPE "ActionType" ADD VALUE 'acknowledge';

ALTER TABLE "Policy" ADD COLUMN "cancellationEffectiveDate" DATE;

ALTER TABLE "InboundEmail"
  ADD COLUMN "inReplyTo" TEXT,
  ADD COLUMN "followUpOfCaseId" TEXT;
ALTER TABLE "InboundEmail"
  ADD CONSTRAINT "InboundEmail_followUpOfCaseId_fkey" FOREIGN KEY ("followUpOfCaseId")
  REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Case"
  ADD COLUMN "handoverReason" TEXT,
  ADD COLUMN "handoverParams" JSONB,
  ADD COLUMN "mergedIntoCaseId" TEXT;

ALTER TABLE "ProposedAction"
  ADD COLUMN "cancellation" JSONB,
  ADD COLUMN "finalDraftSubject" TEXT,
  ADD COLUMN "finalDraftBody" TEXT,
  ADD COLUMN "awaitsWorkflow" BOOLEAN NOT NULL DEFAULT true;
DROP INDEX "ProposedAction_caseId_revision_key";
CREATE UNIQUE INDEX "ProposedAction_caseId_workflowRunId_revision_key"
  ON "ProposedAction"("caseId", "workflowRunId", "revision");
