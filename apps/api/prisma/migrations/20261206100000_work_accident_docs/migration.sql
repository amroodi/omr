-- «شاغلین / بازنشسته» on a case
ALTER TABLE "Claim" ADD COLUMN "employmentStatus" TEXT;

-- Alborz «فوت بر اثر حادثه» › «حادثه ناشی از کار» (در محل کار) has its own documents (the user's list of
-- 2026-11-19): the older documents leave this cause; files already uploaded under them keep their slot.
UPDATE "RequiredDocument" d
SET "causes" = array_remove(d."causes", 'حادثه ناشی از کار')
FROM "Tenant" t
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d."appliesToTypes" = ARRAY['DEATH_ACCIDENT']::text[]
  AND 'حادثه ناشی از کار' = ANY(d."causes") AND d.code NOT LIKE 'dw\_%';

INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "causes", "requiredDetails", "kinds", "order", "isActive")
SELECT gen_random_uuid()::text, t.id, v.code, v.label, ARRAY['DEATH_ACCIDENT']::text[], CASE WHEN v.req THEN ARRAY['DEATH_ACCIDENT']::text[] ELSE '{}'::text[] END,
  ARRAY['حادثه ناشی از کار']::text[], '{}'::text[], '{}'::text[], v.ord, true
FROM "Tenant" t, (VALUES
  ('dw_notice_letter', 'نامه اعلام غرامت فوت بیمه شده از سوی بیمه گزار', true, 501),
  ('dw_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', true, 502),
  ('dw_deceased_id', 'تصویر کارت ملی و کلیه صفحات شناسنامه باطل شده متوفی (ممهور به مهر برابر با اصل)', true, 503),
  ('dw_death_cert', 'گواهی فوت (اصل و یا ممهور به مهر برابر با اصل)', true, 504),
  ('dw_medical_death_cert', 'گواهی پزشکی فوت سن بالای ۷ روز', true, 505),
  ('dw_workplace_report', 'گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که در محل کار بیمه گزار تنظیم شده است (ممهور به مهر بیمه گزار)', true, 506),
  -- where «تصویر مدارک ذینفع/ذینفعان» and «شاغلین / بازنشسته» sit in this list
  ('dw_beneficiary_form', 'تصویر مدارک ذینفع/ذینفعان', true, 507),
  ('dw_employment', 'وضعیت اشتغال بیمه شده', true, 508),
  -- برحسب نیاز
  ('dw_forensic_report', 'گزارش پزشک قانونی مبنی بر علت فوت (بر حسب ضرورت)', false, 509),
  ('dw_burial_permit', 'تصویر جواز دفن (ممهور به مهر برابر با اصل)', false, 510)
) AS v(code, label, req, ord)
WHERE t.slug = 'alborz'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes",
  "requiredTypes" = EXCLUDED."requiredTypes", "causes" = EXCLUDED."causes", "requiredDetails" = EXCLUDED."requiredDetails",
  "order" = EXCLUDED."order", "isActive" = true;
