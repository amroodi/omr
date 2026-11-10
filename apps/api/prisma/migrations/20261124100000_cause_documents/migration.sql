-- Documents per «علت» and «نوع حادثه»: a RequiredDocument may be listed only for some causes and be
-- required only for some «نوع حادثه»; a claim keeps the «نوع حادثه» picked; «+» uploads extra pages.
ALTER TABLE "RequiredDocument" ADD COLUMN "causes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RequiredDocument" ADD COLUMN "requiredDetails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Claim" ADD COLUMN "causeDetail" TEXT;
ALTER TABLE "Document" ADD COLUMN "extra" BOOLEAN NOT NULL DEFAULT false;

-- «بیمه گذار» is written «بیمه گزار» everywhere.
UPDATE "Tenant" SET "workflowModel" = regexp_replace("workflowModel"::text, 'بیمه([ ‌]?)گذار', 'بیمه\1گزار', 'g')::jsonb WHERE "workflowModel"::text ~ 'بیمه[ ‌]?گذار';
UPDATE "RequiredDocument" SET "label" = regexp_replace("label", 'بیمه([ ‌]?)گذار', 'بیمه\1گزار', 'g') WHERE "label" ~ 'بیمه[ ‌]?گذار';
UPDATE "ClaimFieldDef" SET "label" = regexp_replace("label", 'بیمه([ ‌]?)گذار', 'بیمه\1گزار', 'g') WHERE "label" ~ 'بیمه[ ‌]?گذار';
UPDATE "Claim" SET "causeOfDeath" = regexp_replace("causeOfDeath", 'بیمه([ ‌]?)گذار', 'بیمه\1گزار', 'g') WHERE "causeOfDeath" ~ 'بیمه[ ‌]?گذار';

-- Alborz «فوت به هر علت»: a «فوت در اثر حادثه» cause asks for «نوع حادثه».
UPDATE "Tenant" SET "workflowModel" = jsonb_set("workflowModel", '{form,caseTypes}', (
  SELECT jsonb_agg(CASE WHEN x.t->>'code' = 'DEATH_ILLNESS' THEN x.t || jsonb_build_object('detail', '{"label": "نوع حادثه", "options": ["حادثه در محل کار", "فوت به علت حادثه", "حادثه تصادف", "نزاع و درگیری"], "causes": ["فوت در اثر حادثه-ذینفع \"بیمه گزار\"", "فوت در اثر حادثه با برگه ذینفع", "فوت در اثر حادثه-پرداخت در وجه \"وکیل یا وراث\"", "فوت در اثر حادثه-پرداخت در وجه \"وراث قانونی\""]}'::jsonb) ELSE x.t END ORDER BY x.ord)
  FROM jsonb_array_elements("workflowModel"->'form'->'caseTypes') WITH ORDINALITY AS x(t, ord)
))
WHERE slug = 'alborz' AND jsonb_typeof("workflowModel"->'form'->'caseTypes') = 'array';

-- Alborz documents of «فوت به هر علت» and «از کار افتادگی دائم و کامل ناشی از بیماری» (the user's lists of
-- 2026-11-10). The older documents leave these two types; files already uploaded under them keep their slot.
UPDATE "RequiredDocument" d
SET "appliesToTypes" = array_remove(array_remove(d."appliesToTypes", 'DEATH_ILLNESS'), 'DISABILITY_ILLNESS'),
    "requiredTypes" = array_remove(array_remove(d."requiredTypes", 'DEATH_ILLNESS'), 'DISABILITY_ILLNESS')
FROM "Tenant" t
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d.code NOT LIKE 'li\_%' AND d.code NOT LIKE 'di\_%';

INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "causes", "requiredDetails", "kinds", "order", "isActive")
SELECT gen_random_uuid()::text, t.id, v.code, v.label, v.applies, v.req, v.causes, v.dets, '{}'::text[], v.ord, true
FROM "Tenant" t, (VALUES
  ('li_notice_letter', 'نامه اعلام غرامت فوت بیمه شده از سوی بیمه گزار', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 101),
  ('li_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 102),
  ('li_waiting_period', 'بررسی دوره انتظار توسط واحد صدور (دوره انتظار تا ۶ ماه بررسی می‌شود)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['سرطان','سکته قلبی بدون برگه ذینفع','سکته قلبی-پرداخت در وجه وکیل یا وراث','سکته قلبی-پرداخت در وجه بیمه گزار','سکته مغزی-پرداخت در وجه بیمه گزار','سکته قلبی با برگه ذینفع','سکته مغزی با برگه ذینفع']::text[], '{}'::text[], 103),
  ('li_death_cert', 'گواهی فوت (اصل و یا ممهور به مهر برابر با اصل)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 104),
  ('li_medical_death_cert', 'گواهی پزشکی فوت سن بالای ۷ روز', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 105),
  ('li_deceased_id', 'تصویر کارت ملی و کلیه صفحات شناسنامه باطل شده متوفی (ممهور به مهر برابر با اصل)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 106),
  ('li_beneficiary_form', 'اصل فرم تعیین ذینفع که توسط بیمه شده تکمیل و ممهور به مهر بیمه گزار باشد؛ در غیر این صورت گواهی حصر وراثت که در آن سهم‌الارث هر یک از وراث قانونی مشخص شده باشد (با ارزش قانونی نامحدود)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 107),
  ('li_heirs_id', 'تصویر کارت ملی و شناسنامه ذینفعان یا وراث قانونی (ممهور به مهر برابر با اصل)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 108),
  ('li_heirs_iban', 'پرینت بانکی شماره شبای ذینفعان یا وراث قانونی (شامل نام صاحب حساب، نام بانک و شماره شبا)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 109),
  ('li_personnel_order', 'تصویر حکم کارگزینی یا قرارداد کاری بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه فوت بیمه شده (ممهور به مهر بیمه گزار)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 110),
  ('li_ss_list', 'تصویر لیست کسور حق بیمه تامین اجتماعی (بیمه پایه) بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه فوت بیمه شده (ممهور به مهر بیمه گزار)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], 111),
  ('li_forensic_report', 'گزارش پزشک قانونی مبنی بر علت فوت (بر حسب ضرورت)', ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], '{}'::text[], 112),
  ('li_burial_permit', 'تصویر جواز دفن (ممهور به مهر برابر با اصل)', ARRAY['DEATH_ILLNESS']::text[], '{}'::text[], '{}'::text[], '{}'::text[], 113),
  ('li_acc_workplace', 'گزارش علت فوت در اثر حادثه — الف) حادثه در محل کار: گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که در محل کار بیمه گزار تنظیم شده است (ممهور به مهر بیمه گزار)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['فوت در اثر حادثه-ذینفع "بیمه گزار"','فوت در اثر حادثه با برگه ذینفع','فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"','فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"']::text[], ARRAY['حادثه در محل کار']::text[], 114),
  ('li_acc_crash_report', 'گزارش علت فوت در اثر حادثه — ب) تصادف: گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و ممهور به مهر گردد', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['فوت در اثر حادثه-ذینفع "بیمه گزار"','فوت در اثر حادثه با برگه ذینفع','فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"','فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"']::text[], ARRAY['حادثه تصادف']::text[], 115),
  ('li_acc_crash_sketch', 'گزارش علت فوت در اثر حادثه — ب) تصادف: گزارش و کروکی نیروی انتظامی بابت تصادف که مقصر حادثه تعیین شده باشد', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['فوت در اثر حادثه-ذینفع "بیمه گزار"','فوت در اثر حادثه با برگه ذینفع','فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"','فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"']::text[], ARRAY['حادثه تصادف']::text[], 116),
  ('li_acc_driver_license', 'گزارش علت فوت در اثر حادثه — ب) تصادف: تصویر گواهینامه رانندگی معتبر، متناسب با وسیله نقلیه در زمان فوت (در صورتی که بیمه شده رانندگی وسیله نقلیه را بر عهده داشته است)', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['فوت در اثر حادثه-ذینفع "بیمه گزار"','فوت در اثر حادثه با برگه ذینفع','فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"','فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"']::text[], ARRAY['حادثه تصادف']::text[], 117),
  ('li_acc_fight_verdict', 'گزارش علت فوت در اثر حادثه — ج) نزاع و درگیری: رأی مقامات انتظامی و قضایی مبنی بر مقصر نبودن بیمه شده در خصوص حادثه ناشی از نزاع و درگیری', ARRAY['DEATH_ILLNESS']::text[], ARRAY['DEATH_ILLNESS']::text[], ARRAY['فوت در اثر حادثه-ذینفع "بیمه گزار"','فوت در اثر حادثه با برگه ذینفع','فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"','فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"']::text[], ARRAY['نزاع و درگیری']::text[], 118),
  ('di_notice_letter', 'نامه اعلام غرامت از کار افتادگی بیمه شده از سوی بیمه گزار', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 201),
  ('di_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 202),
  ('di_insured_id', 'تصویر کارت ملی و کلیه صفحات شناسنامه (ممهور به مهر برابر با اصل)', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 203),
  ('di_commission', 'برگه‌های کمیسیون پزشکی تایید شده توسط سازمان تامین اجتماعی', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 204),
  ('di_hospital_docs', 'مدارک بیمارستانی مبنی بر بیماری (از کار افتادگی)', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 205),
  ('di_personnel_order', 'تصویر حکم کارگزینی یا قرارداد کاری بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه وقوع از کار افتادگی بیمه شده (ممهور به مهر بیمه گزار)', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 206),
  ('di_ss_list', 'تصویر لیست کسور حق بیمه تامین اجتماعی (بیمه پایه) بیمه شده در ماه شروع پوشش بیمه‌ای و در ماه وقوع از کار افتادگی بیمه شده (ممهور به مهر بیمه گزار)', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 207),
  ('di_iban', 'پرینت بانکی شماره شبای بیمه شده (شامل نام صاحب حساب، نام بانک و شماره شبا)', ARRAY['DISABILITY_ILLNESS']::text[], ARRAY['DISABILITY_ILLNESS']::text[], '{}'::text[], '{}'::text[], 208)
) AS v(code, label, applies, req, causes, dets, ord)
WHERE t.slug = 'alborz'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes",
  "requiredTypes" = EXCLUDED."requiredTypes", "causes" = EXCLUDED."causes", "requiredDetails" = EXCLUDED."requiredDetails",
  "order" = EXCLUDED."order", "isActive" = true;
