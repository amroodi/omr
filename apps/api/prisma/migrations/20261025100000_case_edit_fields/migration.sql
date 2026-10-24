-- Fields used by the new case-edit layout, added for every insurer that already has field definitions:
--   «فوت» (death_kind) and «تکمیل پرونده» (case_complete); «نوع ذینفع» gains وراث قانونی / ذینفع قانونی.
INSERT INTO "ClaimFieldDef" ("id", "tenantId", "key", "label", "type", "group", "options", "editableBy", "order", "required", "isActive", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'death_kind', 'فوت', 'SELECT'::"FieldType", 'CLAIM_DATA'::"FieldGroup",
       ARRAY['در حال بررسی', 'فوت عادی (بیماری)', 'فوت ناشی از حادثه'], ARRAY['MOAREF', 'INSURER_LEVEL']::"ClaimPartyType"[], 12, false, true, NOW()
FROM (SELECT DISTINCT "tenantId" FROM "ClaimFieldDef") t
ON CONFLICT ("tenantId", "key") DO NOTHING;

INSERT INTO "ClaimFieldDef" ("id", "tenantId", "key", "label", "type", "group", "options", "editableBy", "order", "required", "isActive", "createdAt")
SELECT gen_random_uuid()::text, t."tenantId", 'case_complete', 'تکمیل پرونده', 'SELECT'::"FieldType", 'WORKFLOW_STAGE'::"FieldGroup",
       ARRAY['تکمیل', 'ناقص'], ARRAY['MOAREF', 'INSURER_LEVEL']::"ClaimPartyType"[], 46, false, true, NOW()
FROM (SELECT DISTINCT "tenantId" FROM "ClaimFieldDef") t
ON CONFLICT ("tenantId", "key") DO NOTHING;

UPDATE "ClaimFieldDef"
SET "options" = ARRAY['وراث قانونی', 'ذینفع قانونی'] || "options"
WHERE "key" = 'beneficiary_type' AND NOT ('وراث قانونی' = ANY ("options"));
