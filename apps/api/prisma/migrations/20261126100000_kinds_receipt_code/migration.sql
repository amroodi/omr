-- «کد پذیرش»: an 8-digit code per case, to follow it up by; existing cases get one too.
ALTER TABLE "Claim" ADD COLUMN "receiptCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN "submitTo" TEXT;
UPDATE "Claim" c SET "receiptCode" = (10000000 + n.rn)::text
FROM (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn FROM "Claim") n
WHERE n.id = c.id;
CREATE UNIQUE INDEX "Claim_receiptCode_key" ON "Claim"("receiptCode");

-- نوع بیمه‌نامه on every panel 1 (the user, 2026-11-11): عمر گروهی، حوادث گروهی، عمر انفرادی (مانده بدهکار)،
-- حوادث انفرادی. مسئولیت and عمر پس‌انداز are switched off (kept: old cases may carry them).
UPDATE "PlatformConfig" SET "policyKinds" = (
  SELECT jsonb_agg(CASE x.e->>'code'
    WHEN 'LIFE' THEN x.e || '{"label": "عمر گروهی", "active": true}'::jsonb
    WHEN 'ACCIDENT' THEN x.e || '{"label": "حوادث گروهی", "active": true}'::jsonb
    WHEN 'CREDIT_LIFE' THEN x.e || '{"label": "عمر انفرادی (مانده بدهکار)", "active": true}'::jsonb
    WHEN 'ACCIDENT_INDIVIDUAL' THEN x.e || '{"label": "حوادث انفرادی", "active": true}'::jsonb
    WHEN 'LIABILITY' THEN x.e || '{"active": false}'::jsonb
    WHEN 'SAVINGS_LIFE' THEN x.e || '{"active": false}'::jsonb
    ELSE x.e END ORDER BY x.ord)
  FROM jsonb_array_elements("policyKinds") WITH ORDINALITY AS x(e, ord)
) WHERE jsonb_typeof("policyKinds") = 'array';
UPDATE "PlatformConfig" SET "policyKinds" = "policyKinds" || '[{"code": "ACCIDENT_INDIVIDUAL", "label": "حوادث انفرادی", "active": true}]'::jsonb
WHERE jsonb_typeof("policyKinds") = 'array' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("policyKinds") e WHERE e->>'code' = 'ACCIDENT_INDIVIDUAL');
-- Organizations that chose their kinds: the four, in this order.
UPDATE "Tenant" SET "policyKinds" = ARRAY['LIFE','ACCIDENT','CREDIT_LIFE','ACCIDENT_INDIVIDUAL']::text[]
WHERE cardinality("policyKinds") > 0;

-- «جنگ» is a cause of عمر (فوت به هر علت) only, not of any حوادث type; «فوت بر اثر حادثه» gets back
-- «حادثه (با هزینه پزشکی)» and «حادثه (بدون هزینه پزشکی)».
UPDATE "Tenant" SET "workflowModel" = jsonb_set("workflowModel", '{form,caseTypes}', (
  SELECT jsonb_agg(CASE
    WHEN x.t->>'code' = 'DEATH_ACCIDENT' THEN x.t || '{"causes": ["حادثه ناشی از کار", "حادثه غیر ناشی از کار (تصادف)", "زلزله (با فرم تعیین ذینفع)", "زلزله (بدون فرم تعیین ذینفع)", "حادثه (با هزینه پزشکی)", "حادثه (بدون هزینه پزشکی)"]}'::jsonb
    WHEN x.t->>'causeGroup' = 'ACCIDENT' AND jsonb_typeof(x.t->'causes') = 'array' THEN x.t || jsonb_build_object('causes', COALESCE(
      (SELECT jsonb_agg(c ORDER BY o) FROM jsonb_array_elements(x.t->'causes') WITH ORDINALITY AS y(c, o) WHERE c #>> '{}' <> 'جنگ'), '[]'::jsonb))
    WHEN x.t->>'code' = 'DEATH_ILLNESS' AND jsonb_typeof(x.t->'causes') = 'array' AND jsonb_array_length(x.t->'causes') > 0 AND NOT (x.t->'causes' ? 'جنگ')
      THEN x.t || jsonb_build_object('causes', (x.t->'causes') || '["جنگ"]'::jsonb)
    ELSE x.t END ORDER BY x.ord)
  FROM jsonb_array_elements("workflowModel"->'form'->'caseTypes') WITH ORDINALITY AS x(t, ord)
))
WHERE jsonb_typeof("workflowModel"->'form'->'caseTypes') = 'array';

-- Alborz «فوت بر اثر حادثه»: «حادثه غیر ناشی از کار (تصادف)» has its own documents (the user's list of
-- 2026-11-11); the older documents of this type stay for its other causes.
UPDATE "RequiredDocument" d
SET "causes" = ARRAY['حادثه ناشی از کار', 'زلزله (با فرم تعیین ذینفع)', 'زلزله (بدون فرم تعیین ذینفع)', 'حادثه (با هزینه پزشکی)', 'حادثه (بدون هزینه پزشکی)']::text[]
FROM "Tenant" t
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d."appliesToTypes" = ARRAY['DEATH_ACCIDENT']::text[]
  AND cardinality(d."causes") = 0 AND d.code NOT LIKE 'da\_%';

INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "causes", "requiredDetails", "kinds", "order", "isActive")
SELECT gen_random_uuid()::text, t.id, v.code, v.label, ARRAY['DEATH_ACCIDENT']::text[],
  CASE WHEN v.req THEN ARRAY['DEATH_ACCIDENT']::text[] ELSE '{}'::text[] END,
  ARRAY['حادثه غیر ناشی از کار (تصادف)']::text[], '{}'::text[], '{}'::text[], v.ord, true
FROM "Tenant" t, (VALUES
  ('da_crash_notice_letter', 'نامه اعلام غرامت فوت بیمه شده از سوی بیمه گزار', true, 301),
  ('da_crash_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', true, 302),
  ('da_crash_death_cert', 'گواهی فوت (اصل و یا ممهور به مهر برابر با اصل)', true, 303),
  ('da_crash_medical_death_cert', 'گواهی پزشکی فوت سن بالای ۷ روز', true, 304),
  ('da_crash_deceased_id', 'تصویر کارت ملی و کلیه صفحات شناسنامه باطل شده متوفی (ممهور به مهر برابر با اصل)', true, 305),
  ('da_crash_report', 'گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و ممهور به مهر گردد', true, 306),
  ('da_crash_sketch', 'گزارش و کروکی نیروی انتظامی بابت تصادف که مقصر حادثه تعیین شده باشد', true, 307),
  ('da_crash_driver_license', 'تصویر گواهینامه رانندگی معتبر، متناسب با وسیله نقلیه در زمان فوت (در صورتی که بیمه شده رانندگی وسیله نقلیه را بر عهده داشته است)', true, 308),
  ('da_crash_beneficiary_form', 'در صورتی که ذینفع بیمه گزار نباشد: اصل فرم تعیین ذینفع که توسط بیمه شده تکمیل و ممهور به مهر بیمه گزار باشد؛ در غیر این صورت گواهی حصر وراثت که در آن سهم‌الارث هر یک از وراث قانونی مشخص شده باشد (با ارزش قانونی نامحدود)', true, 309),
  ('da_crash_heirs_id', 'در صورتی که ذینفع بیمه گزار نباشد: تصویر کارت ملی و شناسنامه ذینفعان یا وراث قانونی (ممهور به مهر برابر با اصل)', true, 310),
  ('da_crash_heirs_iban', 'در صورتی که ذینفع بیمه گزار نباشد: پرینت بانکی شماره شبای ذینفعان یا وراث قانونی (شامل نام صاحب حساب، نام بانک و شماره شبا)', true, 311),
  ('da_crash_personnel_order', 'تصویر حکم کارگزینی یا قرارداد کاری بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه فوت بیمه شده (ممهور به مهر بیمه گزار)', true, 312),
  ('da_crash_ss_list', 'تصویر لیست کسور حق بیمه تامین اجتماعی (بیمه پایه) بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه فوت بیمه شده (ممهور به مهر بیمه گزار)', true, 313),
  ('da_crash_forensic_report', 'گزارش پزشک قانونی مبنی بر علت فوت (بر حسب ضرورت)', false, 314),
  ('da_crash_burial_permit', 'تصویر جواز دفن (ممهور به مهر برابر با اصل)', false, 315)
) AS v(code, label, req, ord)
WHERE t.slug = 'alborz'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes",
  "requiredTypes" = EXCLUDED."requiredTypes", "causes" = EXCLUDED."causes", "requiredDetails" = EXCLUDED."requiredDetails",
  "order" = EXCLUDED."order", "isActive" = true;
