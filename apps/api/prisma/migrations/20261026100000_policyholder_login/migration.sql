-- بیمه‌گزار panel login (کد بیمه‌گزار + password) and the عمر / حوادث line of each policy.
CREATE TYPE "InsuranceLine" AS ENUM ('LIFE', 'ACCIDENT');

ALTER TABLE "PolicyholderCompany" ADD COLUMN "code" TEXT;
ALTER TABLE "PolicyholderCompany" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "PolicyholderCompany" ADD COLUMN "passwordSetAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PolicyholderCompany_tenantId_code_key" ON "PolicyholderCompany"("tenantId", "code");

ALTER TABLE "PolicyholderContract" ADD COLUMN "line" "InsuranceLine";
