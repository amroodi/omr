-- History of values typed into a claim's stage fields («تاریخچه وضعیت پرونده»).
CREATE TABLE "ClaimFieldLog" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClaimFieldLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClaimFieldLog_claimId_createdAt_idx" ON "ClaimFieldLog"("claimId", "createdAt");

-- New «وضعیت پرونده» field for every insurer that already has the field catalog.
INSERT INTO "ClaimFieldDef" ("id", "tenantId", "key", "label", "type", "group", "options", "editableBy", "order", "required", "isActive", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'case_stage', 'وضعیت پرونده', 'SELECT'::"FieldType", 'WORKFLOW_STAGE'::"FieldGroup",
       ARRAY['نزد بیمه‌گزار','نزد کارگزاری','نزد شعبه','نزد مدیریت ستاد','نزد شورای فنی','در انتظار پرداخت','پرداخت شده','رد شده','بسته شده'],
       ARRAY['MOAREF','INSURER_LEVEL']::"ClaimPartyType"[], 59, false, true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "tenantId" FROM "ClaimFieldDef") t
WHERE NOT EXISTS (SELECT 1 FROM "ClaimFieldDef" d WHERE d."tenantId" = t."tenantId" AND d."key" = 'case_stage');

-- «اعلام فوت» happens before «اعلام کارگزاری به بیمه‌گر».
UPDATE "ClaimFieldDef" SET "order" = 28 WHERE "key" = 'death_notice_date';
UPDATE "ClaimFieldDef" SET "order" = 29 WHERE "key" = 'death_notice_status';
