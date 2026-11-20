-- V14: attachments are real files; Core keeps the bytes and extracts the text itself.
ALTER TABLE "Attachment"
  ADD COLUMN "content" BYTEA NOT NULL DEFAULT '\x',
  ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pageCount" INTEGER,
  ADD COLUMN "extractionStatus" TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE "Attachment"
  ALTER COLUMN "content" DROP DEFAULT,
  ALTER COLUMN "sizeBytes" DROP DEFAULT,
  ALTER COLUMN "extractionStatus" DROP DEFAULT;
