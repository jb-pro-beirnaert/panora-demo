-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('active', 'suspended', 'terminated');

-- CreateTable
CREATE TABLE "Insurer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL,

    CONSTRAINT "Insurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "number" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderNameSearch" TEXT NOT NULL,
    "holderSiren" TEXT NOT NULL,
    "brokerCode" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "endReason" TEXT,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "Coverage" (
    "id" SERIAL NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "peril" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "deductible" INTEGER NOT NULL,
    "exclusions" TEXT[],
    "clauseRef" TEXT NOT NULL,

    CONSTRAINT "Coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clause" (
    "ref" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "general" BOOLEAN NOT NULL,

    CONSTRAINT "Clause_pkey" PRIMARY KEY ("ref")
);

-- CreateTable
CREATE TABLE "Claim" (
    "number" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "nature" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" SERIAL NOT NULL,
    "brokerCode" TEXT,
    "tool" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "isError" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Policy_holderNameSearch_idx" ON "Policy"("holderNameSearch");

-- CreateIndex
CREATE INDEX "Policy_brokerCode_idx" ON "Policy"("brokerCode");

-- CreateIndex
CREATE INDEX "Coverage_policyNumber_idx" ON "Coverage"("policyNumber");

-- CreateIndex
CREATE INDEX "Claim_policyNumber_idx" ON "Claim"("policyNumber");

-- CreateIndex
CREATE INDEX "CallLog_createdAt_idx" ON "CallLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "Policy"("number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "Policy"("number") ON DELETE CASCADE ON UPDATE CASCADE;

