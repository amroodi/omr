-- شماره شبا of a ذینفع / وارث is optional (checked when given).
ALTER TABLE "ClaimHeir" ALTER COLUMN "iban" DROP NOT NULL;

-- Who filed each case (shown on panels 1 and 2), and the insured's gender («آقای» / «خانم»).
ALTER TABLE "Claim" ADD COLUMN "filedById" TEXT;
ALTER TABLE "Claim" ADD COLUMN "filedByKind" TEXT;
ALTER TABLE "Claim" ADD COLUMN "insuredGender" TEXT;

-- Older cases: the first «ثبت پرونده» audit entry names the filer.
WITH first AS (
  SELECT DISTINCT ON (a."targetId") a."targetId" AS claim_id, a."actorType", a."actorId"
  FROM "AuditLog" a
  WHERE a.action = 'CLAIM_SUBMIT' AND a."targetType" = 'Claim' AND a."actorId" IS NOT NULL
  ORDER BY a."targetId", a."createdAt" ASC
)
UPDATE "Claim" c
SET "filedById" = f."actorId",
    "filedByKind" = CASE
      WHEN f."actorType" = 'ORG_USER' THEN 'ORG_USER'
      WHEN ca."companyId" IS NULL AND ca."branchId" IS NOT NULL THEN 'AGENT'
      WHEN ca."passwordHash" IS NOT NULL THEN 'REPRESENTATIVE'
      ELSE 'POLICYHOLDER' END
FROM first f
LEFT JOIN "CustomerAccount" ca ON ca.id = f."actorId"
WHERE c.id = f.claim_id AND c."filedById" IS NULL AND f."actorType" IN ('ORG_USER', 'CUSTOMER');
