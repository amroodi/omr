-- بیمه‌گزار companies (with subsidiaries), their insurer contracts, inquiry messages.
CREATE TABLE "PolicyholderCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "website" TEXT,
    "contactName" TEXT,
    "logoKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PolicyholderCompany_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PolicyholderCompany_tenantId_idx" ON "PolicyholderCompany"("tenantId");
ALTER TABLE "PolicyholderCompany" ADD CONSTRAINT "PolicyholderCompany_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PolicyholderCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PolicyholderContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "insurerTenantId" TEXT NOT NULL,
    "policyNumber" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyholderContract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PolicyholderContract_companyId_idx" ON "PolicyholderContract"("companyId");
ALTER TABLE "PolicyholderContract" ADD CONSTRAINT "PolicyholderContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "PolicyholderCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InquiryMessage" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "companyId" TEXT,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InquiryMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InquiryMessage_claimId_idx" ON "InquiryMessage"("claimId");
CREATE INDEX "InquiryMessage_companyId_idx" ON "InquiryMessage"("companyId");

ALTER TABLE "CustomerAccount" ADD COLUMN "companyId" TEXT;
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "PolicyholderCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Claim" ADD COLUMN "policyholderCompanyId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "deceasedBirthDate" TIMESTAMP(3);
CREATE INDEX "Claim_policyholderCompanyId_idx" ON "Claim"("policyholderCompanyId");
