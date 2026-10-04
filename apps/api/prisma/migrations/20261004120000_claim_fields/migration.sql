-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'AMOUNT', 'DATE', 'SELECT', 'BOOL', 'NATIONAL_CODE', 'IBAN');
-- CreateEnum
CREATE TYPE "FieldGroup" AS ENUM ('CLAIM_DATA', 'BENEFICIARY', 'WORKFLOW_STAGE');
-- CreateEnum
CREATE TYPE "FieldSource" AS ENUM ('MANUAL', 'OCR', 'OCR_CORRECTED');
-- CreateTable
CREATE TABLE "ClaimFieldDef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL DEFAULT 'TEXT',
    "group" "FieldGroup" NOT NULL DEFAULT 'CLAIM_DATA',
    "options" TEXT[],
    "editableBy" "ClaimPartyType"[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimFieldDef_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ClaimFieldValue" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "source" "FieldSource" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "sourceDocId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimFieldValue_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ClaimFieldDef_tenantId_idx" ON "ClaimFieldDef"("tenantId");
-- CreateIndex
CREATE UNIQUE INDEX "ClaimFieldDef_tenantId_key_key" ON "ClaimFieldDef"("tenantId", "key");
-- CreateIndex
CREATE INDEX "ClaimFieldValue_claimId_idx" ON "ClaimFieldValue"("claimId");
-- CreateIndex
CREATE UNIQUE INDEX "ClaimFieldValue_claimId_key_key" ON "ClaimFieldValue"("claimId", "key");
-- AddForeignKey
ALTER TABLE "ClaimFieldDef" ADD CONSTRAINT "ClaimFieldDef_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClaimFieldValue" ADD CONSTRAINT "ClaimFieldValue_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
