-- Workflow v2: one stage model (بیمه‌گزار → کارگزاری → شعبه → مدیریت ستاد → شورای فنی).

-- مدیریت ستاد becomes its own review checkpoint; COUNCIL now means شورای فنی only.
ALTER TYPE "ReviewStage" ADD VALUE 'HQ';

CREATE TYPE "WorkflowStage" AS ENUM ('POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL');
CREATE TYPE "FlowDirection" AS ENUM ('UP', 'DOWN');
CREATE TYPE "FlowPurpose" AS ENUM ('REVIEW', 'DEFICIENCY', 'PAYMENT');

ALTER TABLE "Tenant" ADD COLUMN "hqCeiling" DECIMAL(18,2);
ALTER TABLE "OrgUser" ADD COLUMN "desk" "WorkflowStage";

ALTER TABLE "Claim"
  ADD COLUMN "currentStage" "WorkflowStage",
  ADD COLUMN "flowDirection" "FlowDirection",
  ADD COLUMN "flowPurpose" "FlowPurpose",
  ADD COLUMN "returnTargetStage" "WorkflowStage",
  ADD COLUMN "handlingBranchId" TEXT,
  ADD COLUMN "lossNoticeNumber" TEXT,
  ADD COLUMN "lossNoticeDate" TIMESTAMP(3),
  ADD COLUMN "lossNoticeById" TEXT;

ALTER TABLE "ClaimStep"
  ADD COLUMN "stage" "WorkflowStage",
  ADD COLUMN "purpose" "FlowPurpose",
  ADD COLUMN "action" TEXT;

CREATE TABLE "ClaimLetter" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "stepId" TEXT,
    "number" TEXT,
    "letterDate" TIMESTAMP(3),
    "subject" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdById" TEXT,
    "createdByTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimLetter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimLetter_claimId_idx" ON "ClaimLetter"("claimId");
CREATE INDEX "ClaimLetter_stepId_idx" ON "ClaimLetter"("stepId");
ALTER TABLE "ClaimLetter" ADD CONSTRAINT "ClaimLetter_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
