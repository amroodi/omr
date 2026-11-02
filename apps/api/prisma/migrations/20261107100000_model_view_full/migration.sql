-- فن‌آوران coverage inquiry (off until configured)
ALTER TABLE "Tenant" ADD COLUMN "coverageConfig" JSONB;
ALTER TABLE "Claim" ADD COLUMN "coverageStatus" TEXT, ADD COLUMN "coverageCheckedAt" TIMESTAMP(3);
CREATE INDEX "Claim_coverageStatus_idx" ON "Claim"("coverageStatus") WHERE "coverageStatus" = 'NOT_CHECKED';

-- «پنل بیمه‌شده»: mobile numbers invited onto a case
CREATE TABLE "ClaimInsuredAccess" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimInsuredAccess_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimInsuredAccess_phoneHash_idx" ON "ClaimInsuredAccess"("phoneHash");
CREATE INDEX "ClaimInsuredAccess_claimId_idx" ON "ClaimInsuredAccess"("claimId");
ALTER TABLE "ClaimInsuredAccess" ADD CONSTRAINT "ClaimInsuredAccess_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
