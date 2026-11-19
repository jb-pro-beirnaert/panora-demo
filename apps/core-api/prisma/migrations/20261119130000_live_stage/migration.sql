-- V13: live stage of a case.

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "currentStep" TEXT,
ADD COLUMN     "currentTool" TEXT;
