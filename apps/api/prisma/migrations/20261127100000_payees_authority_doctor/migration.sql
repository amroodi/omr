-- گیرندگان خسارت: نام پدر and شماره شناسنامه for the payment order.
ALTER TABLE "ClaimHeir" ADD COLUMN "fatherName" TEXT;
ALTER TABLE "ClaimHeir" ADD COLUMN "birthCertNo" TEXT;

-- ستاد approves the amount شعبه proposed.
ALTER TABLE "Claim" ADD COLUMN "amountApprovedAt" TIMESTAMP(3);
ALTER TABLE "Claim" ADD COLUMN "amountApprovedById" TEXT;
-- Cases already past ستاد (a payment order given) count as approved.
UPDATE "Claim" SET "amountApprovedAt" = now() WHERE "finalizedAmount" IS NOT NULL AND ("flowPurpose" = 'PAYMENT' OR status IN ('APPROVED', 'PAID'));

-- مجوز سرپرستی (حدود اختیار) per case.
CREATE TABLE "PaymentAuthority" (
  "id" TEXT NOT NULL, "claimId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT, "granteeId" TEXT,
  "ceiling" DECIMAL(20,0) NOT NULL, "grantedById" TEXT, "requestedByCouncil" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentAuthority_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentAuthority_claimId_idx" ON "PaymentAuthority"("claimId");
CREATE INDEX "PaymentAuthority_granteeId_status_idx" ON "PaymentAuthority"("granteeId", "status");
-- Cases already waiting at شعبه for payment: an authority for the handling شعبه, so they can still be paid.
INSERT INTO "PaymentAuthority" ("id", "claimId", "tenantId", "branchId", "granteeId", "ceiling", "note")
SELECT gen_random_uuid()::text, c.id, c."insurerTenantId", c."handlingBranchId", c."evaluatorId", COALESCE(c."finalizedAmount", c."claimedAmount"), 'صادرشده هنگام راه‌اندازی مجوز سرپرستی'
FROM "Claim" c WHERE c."flowPurpose" = 'PAYMENT' AND c.status = 'APPROVED' AND c."deletedAt" IS NULL;

-- «فرم ارفاقی»
CREATE TABLE "ClaimConcession" (
  "id" TEXT NOT NULL, "claimId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdById" TEXT, "details" TEXT, "fields" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimConcession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimConcession_claimId_idx" ON "ClaimConcession"("claimId");

-- «اظهار نظر پزشک معتمد»
CREATE TABLE "DoctorReferral" (
  "id" TEXT NOT NULL, "claimId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "doctorId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "request" JSONB NOT NULL, "answer" JSONB, "status" TEXT NOT NULL DEFAULT 'PENDING', "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "answeredAt" TIMESTAMP(3),
  CONSTRAINT "DoctorReferral_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DoctorReferral_doctorId_status_idx" ON "DoctorReferral"("doctorId", "status");
CREATE INDEX "DoctorReferral_claimId_idx" ON "DoctorReferral"("claimId");

-- A «پزشک معتمد» role at every insurer (its users sign in to the doctor panel only).
INSERT INTO "Role" ("id", "tenantId", "name", "permissions", "createdAt")
SELECT gen_random_uuid()::text, t.id, 'پزشک معتمد', ARRAY['doctor:opine']::text[], now()
FROM "Tenant" t WHERE t.kind = 'INSURER' AND NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."tenantId" = t.id AND r.name = 'پزشک معتمد');
