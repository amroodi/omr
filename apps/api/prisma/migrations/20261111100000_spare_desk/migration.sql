-- «میز کار مستقل»: a brokerage's own cases, in tables of their own, outside the claim hierarchy.
ALTER TABLE "Tenant" ADD COLUMN "spareDeskEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SpareCase" (
  "id" TEXT NOT NULL,
  "seq" SERIAL NOT NULL,
  "tenantId" TEXT NOT NULL,
  "claimType" TEXT NOT NULL,
  "values" TEXT NOT NULL,
  "nationalCodeHash" TEXT,
  "imported" BOOLEAN NOT NULL DEFAULT false,
  "sharedCompanyId" TEXT,
  "sharedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SpareCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpareCase_tenantId_deletedAt_idx" ON "SpareCase"("tenantId", "deletedAt");
CREATE INDEX "SpareCase_nationalCodeHash_idx" ON "SpareCase"("nationalCodeHash");
CREATE INDEX "SpareCase_sharedCompanyId_idx" ON "SpareCase"("sharedCompanyId");
ALTER TABLE "SpareCase" ADD CONSTRAINT "SpareCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SpareDocument" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "docCode" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpareDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpareDocument_caseId_idx" ON "SpareDocument"("caseId");
ALTER TABLE "SpareDocument" ADD CONSTRAINT "SpareDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SpareCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SpareCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpareCase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_own ON "SpareCase" USING (rls_tenant() IS NULL OR "tenantId" = rls_tenant());
ALTER TABLE "SpareDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SpareDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_own ON "SpareDocument" USING (rls_tenant() IS NULL OR "tenantId" = rls_tenant());

-- A brokerage's admin role is locked in its panel, so it receives the new permission here (to grant it on).
UPDATE "Role" r SET "permissions" = array_append(r."permissions", 'spare:work')
FROM "Tenant" t
WHERE r."tenantId" = t."id" AND t."kind" = 'BROKER' AND 'role:manage' = ANY(r."permissions") AND NOT 'spare:work' = ANY(r."permissions");
