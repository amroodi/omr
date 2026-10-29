-- Two-step login (TOTP) for org users and super admins; org-wide «MFA required» switch.
ALTER TABLE "SuperAdmin" ADD COLUMN "totpPending" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "OrgUser" ADD COLUMN "totpPending" TEXT;
ALTER TABLE "OrgUser" ADD COLUMN "totpLastStep" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "requireMfa" BOOLEAN NOT NULL DEFAULT false;

-- Shared rate-limit counters (every API process sees the same limits). UNLOGGED: fast, and the
-- counters need not survive a database crash.
CREATE UNLOGGED TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- Indexes for the hot paths: work-desk queues, a case's documents, audit history per record,
-- a company's representatives.
CREATE INDEX "Claim_insurerTenantId_currentStage_idx" ON "Claim"("insurerTenantId", "currentStage");
CREATE INDEX "Claim_brokerTenantId_currentStage_idx" ON "Claim"("brokerTenantId", "currentStage");
CREATE INDEX "Claim_policyHolderId_idx" ON "Claim"("policyHolderId");
CREATE INDEX "Document_claimId_createdAt_idx" ON "Document"("claimId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "CustomerAccount_companyId_idx" ON "CustomerAccount"("companyId");
