-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('INSURER', 'BROKER');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('DIRECT', 'BROKER');

-- CreateEnum
CREATE TYPE "ApprovalLevelKind" AS ENUM ('INSURER_CLAIMS', 'TECHNICAL_MGMT', 'COUNCIL_DEPUTY', 'TECHNICAL_COUNCIL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED_INCOMPLETE', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "ClaimPartyType" AS ENUM ('POLICYHOLDER', 'MOAREF', 'INSURER_LEVEL');

-- CreateEnum
CREATE TYPE "ClaimStepState" AS ENUM ('PENDING', 'FORWARDED', 'ESCALATED', 'APPROVED', 'RETURNED_INCOMPLETE', 'REJECTED', 'ACKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_SUBMIT';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_FORWARD';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_ESCALATE';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_RETURN_INCOMPLETE';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_RECTIFY';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_REJECT';
ALTER TYPE "AuditAction" ADD VALUE 'CLAIM_PAY';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "kind" "TenantKind" NOT NULL DEFAULT 'BROKER';

-- CreateTable
CREATE TABLE "ApprovalLevel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "ceiling" DECIMAL(18,2),
    "kind" "ApprovalLevelKind" NOT NULL DEFAULT 'CUSTOM',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "insurerTenantId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "brokerTenantId" TEXT,
    "sellingBranchId" TEXT,
    "policyHolderId" TEXT,
    "deceasedFullName" TEXT NOT NULL,
    "deceasedNationalCode" TEXT NOT NULL,
    "deceasedNationalCodeHash" TEXT NOT NULL,
    "policyNumber" TEXT,
    "claimedAmount" DECIMAL(18,2) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimStep" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "partyType" "ClaimPartyType" NOT NULL,
    "levelId" TEXT,
    "holderTenantId" TEXT NOT NULL,
    "holderBranchId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "state" "ClaimStepState" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimParticipant" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimDeficiency" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "raisedByTenantId" TEXT,
    "raisedByStepId" TEXT,
    "items" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimDeficiency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalLevel_tenantId_idx" ON "ApprovalLevel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLevel_tenantId_order_key" ON "ApprovalLevel"("tenantId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_claimNumber_key" ON "Claim"("claimNumber");

-- CreateIndex
CREATE INDEX "Claim_insurerTenantId_status_idx" ON "Claim"("insurerTenantId", "status");

-- CreateIndex
CREATE INDEX "Claim_brokerTenantId_idx" ON "Claim"("brokerTenantId");

-- CreateIndex
CREATE INDEX "Claim_deceasedNationalCodeHash_idx" ON "Claim"("deceasedNationalCodeHash");

-- CreateIndex
CREATE INDEX "ClaimStep_claimId_order_idx" ON "ClaimStep"("claimId", "order");

-- CreateIndex
CREATE INDEX "ClaimStep_holderTenantId_state_idx" ON "ClaimStep"("holderTenantId", "state");

-- CreateIndex
CREATE INDEX "ClaimParticipant_tenantId_idx" ON "ClaimParticipant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimParticipant_claimId_tenantId_key" ON "ClaimParticipant"("claimId", "tenantId");

-- CreateIndex
CREATE INDEX "ClaimDeficiency_claimId_idx" ON "ClaimDeficiency"("claimId");

-- AddForeignKey
ALTER TABLE "ApprovalLevel" ADD CONSTRAINT "ApprovalLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimStep" ADD CONSTRAINT "ClaimStep_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimParticipant" ADD CONSTRAINT "ClaimParticipant_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDeficiency" ADD CONSTRAINT "ClaimDeficiency_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
