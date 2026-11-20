-- V15: renewal date and client cancellation (MCP `request_cancellation`).
ALTER TABLE "Policy"
  ADD COLUMN "renewalDate" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "cancellationRequestedAt" DATE;
ALTER TABLE "Policy" ALTER COLUMN "renewalDate" DROP DEFAULT;
