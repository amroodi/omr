-- Alborz «فوت بر اثر حادثه» › «حادثه غیر ناشی از کار (تصادف)»: the user's list of 2026-11-21, in its order.
-- «تصویر مدارک ذینفع/ذینفعان» sits as the 8th row (its slot row: da_crash_beneficiary_form).
UPDATE "RequiredDocument" d
SET "label" = v.label, "order" = v.ord, "isActive" = true,
    "requiredTypes" = CASE WHEN v.req THEN ARRAY['DEATH_ACCIDENT']::text[] ELSE '{}'::text[] END
FROM "Tenant" t, (VALUES
  ('da_crash_notice_letter', 'نامه اعلام غرامت فوت بیمه شده از سوی بیمه گزار', true, 301),
  ('da_crash_coverage_form', 'فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور', true, 302),
  ('da_crash_death_cert', 'گواهی فوت (اصل و یا ممهور به مهر برابر با اصل)', true, 303),
  ('da_crash_medical_death_cert', 'گواهی پزشکی فوت سن بالای ۷ روز', true, 304),
  ('da_crash_deceased_id', 'تصویر کارت ملی و کلیه صفحات شناسنامه باطل شده متوفی (ممهور به مهر برابر با اصل)', true, 305),
  ('da_crash_report', 'گزارش مشروح حادثه با ذکر نام بیمه شده و تاریخ وقوع حادثه که توسط مراجع ذی صلاح انتظامی یا قضایی تنظیم و ممهور به مهر گردد', true, 306),
  ('da_crash_sketch', 'گزارش و کروکی نیروی انتظامی بابت تصادف که مقصر حادثه تعیین شده باشد', true, 307),
  ('da_crash_driver_license', 'تصویر گواهینامه رانندگی معتبر، متناسب با وسیله نقلیه در زمان فوت (در صورتی که بیمه شده رانندگی وسیله نقلیه را بر عهده داشته است)', true, 308),
  ('da_crash_beneficiary_form', 'تصویر مدارک ذینفع/ذینفعان', true, 309),
  ('da_crash_personnel_order', 'تصویر حکم کارگزینی یا قرارداد کاری بیمه شده در ماه شروع پوشش بیمه ای و در ماه فوت بیمه شده ممهور به مهر بیمه گزار', true, 310),
  ('da_crash_ss_list', 'تصویر لیست کسور حق بیمه تامین اجتماعی (بیمه پایه) بیمه شده در ماه شروع پوشش بیمه ای و در ماه فوت بیمه شده ممهور به مهر بیمه گزار', true, 311)
) AS v(code, label, req, ord)
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d.code = v.code;

-- Not in the list any more: off (files already uploaded under them keep their slot).
UPDATE "RequiredDocument" d SET "isActive" = false
FROM "Tenant" t
WHERE t.id = d."tenantId" AND t.slug = 'alborz' AND d.code IN ('da_crash_forensic_report', 'da_crash_burial_permit');
