-- فن‌آوران coverage inquiry (off until configured)
ALTER TABLE "Tenant" ADD COLUMN "coverageConfig" JSONB;
ALTER TABLE "Claim" ADD COLUMN "coverageStatus" TEXT, ADD COLUMN "coverageCheckedAt" TIMESTAMP(3);
CREATE INDEX "Claim_coverageStatus_idx" ON "Claim"("coverageStatus") WHERE "coverageStatus" = 'NOT_CHECKED';

-- The بیمه‌شده's upload link names its documents
ALTER TABLE "CaseUploadLink" ADD COLUMN "docCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
