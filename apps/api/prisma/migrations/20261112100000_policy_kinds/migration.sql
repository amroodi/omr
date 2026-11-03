-- نوع بیمه‌نامه: three more kinds besides عمر and حوادث.
ALTER TYPE "InsuranceLine" ADD VALUE IF NOT EXISTS 'LIABILITY';
ALTER TYPE "InsuranceLine" ADD VALUE IF NOT EXISTS 'CREDIT_LIFE';
ALTER TYPE "InsuranceLine" ADD VALUE IF NOT EXISTS 'SAVINGS_LIFE';

-- Each case records its kind, so panel 1 can show one kind at a time.
ALTER TABLE "Claim" ADD COLUMN "line" "InsuranceLine";
CREATE INDEX "Claim_line_idx" ON "Claim"("line");

-- Existing cases: the kind of the contract they were filed under (same company, insurer and policy number)…
UPDATE "Claim" c SET "line" = k."line"
FROM "PolicyholderContract" k
WHERE c."line" IS NULL AND k."line" IS NOT NULL
  AND c."policyholderCompanyId" = k."companyId" AND c."insurerTenantId" = k."insurerTenantId" AND c."policyNumber" = k."policyNumber";

-- …else the default split of نوع پرونده (fatal or disabling illness = عمر, the rest = حوادث).
UPDATE "Claim" SET "line" = 'LIFE' WHERE "line" IS NULL AND "claimType" IN ('DEATH_ILLNESS', 'DISABILITY_ILLNESS');
UPDATE "Claim" SET "line" = 'ACCIDENT' WHERE "line" IS NULL;
