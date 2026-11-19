-- V12: a single implicit broker, no sign-in.

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_brokerId_fkey";

-- DropTable
DROP TABLE "Session";

-- AlterTable
ALTER TABLE "Broker" DROP COLUMN "passwordHash";
