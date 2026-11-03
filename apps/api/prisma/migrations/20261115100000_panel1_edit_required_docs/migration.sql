-- Each ذینفع's share (%) as written on «فرم تعیین/تغییر ذینفع» (optional).
ALTER TABLE "ClaimHeir" ADD COLUMN "sharePercent" DECIMAL(5,2);

-- A کارگزاری's own list of documents its panel 1 must upload (empty = the insurer's rules).
ALTER TABLE "Tenant" ADD COLUMN "entryRequiredDocs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Two new document types for death cases, added to every insurer's list (Model View › مدارک).
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "kinds", "order", "isActive", "createdAt")
SELECT gen_random_uuid()::text, t."id", v.code, v.label, ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT'], ARRAY[]::TEXT[], ARRAY[]::TEXT[], v.ord, true, now()
FROM "Tenant" t
CROSS JOIN (VALUES
  ('no_beneficiary_form_letter', 'نامه بیمه‌گزار مبنی بر پر نکردن فرم ذینفع.', 15),
  ('iban_printout', 'تصویر پرینت شماره شبا.', 17)
) AS v(code, label, ord)
WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- دامون's panel 1: only these are required; the rest of the list is optional (shown greyed).
UPDATE "Tenant" SET "entryRequiredDocs" = ARRAY[
  'police_initial_report', 'workplace_report_death', 'physician_death_cert', 'autopsy_forensic',
  'burial_permit_cause', 'deceased_id_national_card', 'inheritance_cert', 'heirs_id_national_card',
  'no_beneficiary_form_letter', 'retirement_list_death', 'retirement_list_start_death',
  'last_personnel_order', 'employment_contract_payslips', 'traffic_crash_sketch', 'driver_license_valid',
  'iban_printout'
] WHERE "slug" = 'damuon' AND "kind" = 'BROKER';
