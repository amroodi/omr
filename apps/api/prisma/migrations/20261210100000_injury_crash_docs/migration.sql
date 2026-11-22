-- A document list made for one نوع پرونده + «علت» takes the place of the type's shared documents.
ALTER TABLE "RequiredDocument" ADD COLUMN "exclusive" BOOLEAN NOT NULL DEFAULT false;

-- Alborz «نقص عضو و از کار افتادگی بر اثر حادثه» › «حادثه غیر ناشی از کار (تصادف)» (the user's list of 2026-11-22).
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "causes", "requiredDetails", "kinds", "exclusive", "order", "isActive")
SELECT gen_random_uuid()::text, t.id, v.code, v.label, ARRAY['DISABILITY_ACCIDENT']::text[], CASE WHEN v.req THEN ARRAY['DISABILITY_ACCIDENT']::text[] ELSE '{}'::text[] END,
  ARRAY['حادثه غیر ناشی از کار (تصادف)']::text[], '{}'::text[], '{}'::text[], true, v.ord, true
FROM "Tenant" t, (VALUES
  ('it_notice_letter', 'نامه اعلام غرامت فوت بیمه شده از سوی بیمه گزار', true, 601),
  ('it_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', true, 602),
  ('it_insured_id', 'تصویر کارت ملی بیمه شده', true, 603),
  ('it_first_facility', 'گواهی پزشکی اولین مرجع درمانی که بیمه شده بلافاصله پس از مصدومیت به آن مراجعه نموده است', true, 604),
  ('it_treatment_end', 'گواهی پزشک معالج مبنی بر خاتمه معالجات و تائید نقص عضو', false, 605),
  ('it_medical_records', 'تصویر کلیه مدارک و سوابق پزشکی مرتبط در زمان وقوع حادثه', true, 606),
  ('it_imaging', 'رادیوگرافی و یا MRI انجام شده در زمان وقوع حادثه (ارائه در زمان معاینه پزشکی ضروریست)', false, 607),
  ('it_report', 'گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که توسط مراجع ذی صلاح انتظامی یا قضایی تنظیم و ممهور به مهر گردد', true, 608),
  ('it_sketch', 'گزارش و کروکی نیروی انتظامی بابت تصادف که مقصر حادثه تعیین شده باشد', true, 609),
  ('it_driver_license', 'تصویر گواهینامه رانندگی معتبر، متناسب با وسیله نقلیه در زمان وقوع حادثه (در صورتی که بیمه شده رانندگی وسیله نقلیه را بر عهده داشته است)', true, 610),
  -- where «وضعیت اشتغال بیمه شده» and «تصویر مدارک ذینفع/ذینفعان» sit (10th and 11th)
  ('it_employment', 'وضعیت اشتغال بیمه شده', true, 611),
  ('it_beneficiary_form', 'تصویر مدارک ذینفع/ذینفعان', true, 612),
  ('it_insured_iban', 'پرینت بانکی شماره شبای بیمه شده (شامل نام صاحب حساب، نام بانک و شماره شبا)', true, 613)
) AS v(code, label, req, ord)
WHERE t.slug = 'alborz'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes",
  "requiredTypes" = EXCLUDED."requiredTypes", "causes" = EXCLUDED."causes", "exclusive" = true, "order" = EXCLUDED."order", "isActive" = true;
