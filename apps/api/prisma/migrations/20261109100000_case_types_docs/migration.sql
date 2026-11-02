-- نوع پرونده becomes a per-insurer code (Model View) instead of a fixed enum.
ALTER TABLE "Claim" ALTER COLUMN "claimType" DROP DEFAULT;
ALTER TABLE "Claim" ALTER COLUMN "claimType" TYPE TEXT USING "claimType"::TEXT;
ALTER TABLE "Claim" ALTER COLUMN "claimType" SET DEFAULT 'DEATH_ILLNESS';
ALTER TABLE "RequiredDocument" ALTER COLUMN "appliesToTypes" TYPE TEXT[] USING "appliesToTypes"::TEXT[];
ALTER TABLE "RequiredDocument" ADD COLUMN "requiredTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
DROP TYPE "ClaimType";

-- Which types a line offers changed: saved models take the new defaults (editable in Model View).
UPDATE "Tenant" SET "workflowModel" = "workflowModel" #- '{form,lines,LIFE,claimTypes}' #- '{form,lines,ACCIDENT,claimTypes}'
WHERE "workflowModel" IS NOT NULL;

-- Alborz's checklists replace the document catalog of every insurer. Files stay matched by code.
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'loss_notice_death', 'نامه اعلام خسارت بیمه‌گذار / معرف / ذینفع.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 1, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'coverage_form_death', 'فرم تکمیل‌شده تعیین وضعیت پوشش بیمه‌ای بیمه‌شده توسط واحد صدور و تأیید واحد صدور سرپرستی.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 2, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'police_initial_report', 'گزارش مشروح حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و تأیید گردیده و نام بیمه‌شده و تاریخ دقیق وقوع حادثه در آن ذکر شده باشد (ممهور به مهر مراجع ذی‌صلاح).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 3, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'workplace_report_death', 'گزارش مشروح حادثه با ذکر نام بیمه‌شده و تاریخ وقوع حادثه که در محل کار تنظیم و به تأیید کارشناس وزارت کار یا سازمان تأمین اجتماعی و یا واحد ایمنی و بهداشت کار بیمه‌گذار رسیده باشد.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 4, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'traffic_crash_sketch', 'گزارش و کروکی نیروهای انتظامی درخصوص تصادفات و سوانح رانندگی.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 5, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'witness_statement_death', 'استشهاد محلی تنظیمی مبنی بر شرح حادثه با ذکر نام بیمه‌شده و تاریخ دقیق وقوع حادثه و آدرس و شماره تلفن شهود که به تأیید شورای محل / مسجد محل / مقامات انتظامی رسیده باشد.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 6, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'quarrel_verdict_death', 'رأی مقامات انتظامی و قضایی مبنی بر مقصر نبودن بیمه‌شده درخصوص حوادث ناشی از نزاع و درگیری.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 7, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'physician_death_cert', 'گواهی پزشک معالج یا پزشک قانونی مبنی بر علت فوت.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 8, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'court_verdict_death', 'رأی نهایی دادگاه مبنی بر علت تامه فوت (برحسب مورد).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 9, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'autopsy_forensic', 'گزارش معاینه جسد (برحسب نیاز).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 10, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'death_certificate', 'تصویر خلاصه رونوشت وفات.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 11, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'burial_permit_cause', 'تصویر جواز دفن (پروانه دفن).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 12, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'deceased_id_national_card', 'تصویر کلیه صفحات شناسنامه باطل‌شده و کارت ملی متوفی.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 13, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'inheritance_cert', 'گواهی حصر وراثت که در آن سهم‌الارث هر یک از وراث قانونی مشخص شده باشد (با ارزش نامحدود و یا برابر با سرمایه فوت).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 14, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'beneficiary_form', 'اصل فرم تعیین ذینفع تکمیل‌شده توسط بیمه‌شده (ممهور به مهر بیمه‌گذار).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 15, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'medical_questionnaire', 'فرم پرسشنامه پزشکی بیمه‌شده که در زمان حیات تکمیل گردیده است (ممهور به مهر بیمه‌گذار).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 16, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'heirs_id_national_card', 'تصویر کلیه صفحات شناسنامه وراث قانونی طبق گواهی حصر وراثت و یا ذینفع‌های مشخص‌شده در فرم تعیین ذینفع.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], 17, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'driver_license_valid', 'تصویر گواهینامه رانندگی متناسب با وسیله نقلیه و معتبر در زمان وقوع فوت (در صورتی که بیمه‌شده رانندگی وسیله نقلیه را به عهده داشته است).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 18, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'passport_deceased', 'تصویر کلیه صفحات گذرنامه متوفی که در آن تاریخ ورود و خروج از کشور قید شده باشد.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 19, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'martyr_cert', 'گواهی شهادت متوفی (در صورت فوت بیمه‌شده در عتبات عالیات).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 20, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'loan_form', 'فرم استعلام شرایط وام (برای بیمه‌های عمر مانده بدهکار).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 21, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_list_death', 'تصویر لیست کسور حق بیمه بازنشستگی در ماه فوت بیمه‌شده / ماه قبل از آن.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 22, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_list_start_death', 'تصویر لیست کسور حق بیمه بازنشستگی در زمان شروع پوشش بیمه‌ای بیمه‌شده.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 23, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'last_personnel_order', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در ماه فوت.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 24, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'employment_contract_payslips', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در زمان شروع پوشش بیمه‌ای بیمه‌شده.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 25, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_order_death', 'حکم بازنشستگی / از کار افتادگی دائم و کامل بیمه‌شده که تاریخ بازنشستگی / از کار افتادگی وی در آن درج شده باشد.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 26, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'master_list_death', 'لیست ملاک عمل و الحاقیه مربوطه که به تأیید واحد صدور سرپرستی رسیده باشد (صفحه‌ای که نام بیمه‌شده در آن درج شده باشد).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 27, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'report_voucher_death', 'گزارش و حواله.', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 28, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'policy_copy_death', 'تصویر بیمه‌نامه و شرایط خصوصی مهر و امضاءشده توسط بیمه‌گذار (برحسب مورد).', ARRAY['DEATH_ILLNESS', 'DEATH_ACCIDENT']::TEXT[], ARRAY[]::TEXT[], 29, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'loss_notice_accident', 'نامه اعلام خسارت بیمه‌گذار / بیمه‌شده / معرف.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 30, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'coverage_form_accident', 'فرم تکمیل‌شده تعیین وضعیت پوشش بیمه‌ای بیمه‌شده توسط واحد صدور و تأیید واحد صدور سرپرستی.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 31, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'accident_report', 'گزارش مشروح حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و تأیید گردیده و نام بیمه‌شده و تاریخ دقیق وقوع حادثه در آن ذکر شده باشد (ممهور به مهر مراجع مذکور).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 32, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'traffic_report_accident', 'گزارش و کروکی نیروهای انتظامی درخصوص تصادفات و سوانح رانندگی.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 33, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'workplace_report_accident', 'گزارش مشروح حادثه با ذکر نام بیمه‌شده و تاریخ وقوع حادثه که در محل کار تنظیم و به تأیید کارشناس وزارت کار یا سازمان تأمین اجتماعی و یا واحد ایمنی و بهداشت کار بیمه‌گذار رسیده باشد (برای حوادث ناشی از کار).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 34, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'witness_statement_accident', 'استشهاد محلی تنظیمی مبنی بر شرح حادثه با ذکر نام بیمه‌شده و تاریخ دقیق وقوع حادثه و آدرس و شماره تلفن شهود که به تأیید شورای محل / مسجد محل / مقامات انتظامی رسیده باشد.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 35, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'quarrel_verdict_accident', 'رأی مقامات انتظامی و قضایی مبنی بر مقصر نبودن بیمه‌شده درخصوص حوادث ناشی از نزاع و درگیری.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 36, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'first_medical_facility_cert', 'گواهی اولین مرجع درمانی که بیمه‌شده بلافاصله پس از مصدومیت به آن مراجعه نموده است.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], 37, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'disability_medical_cert', 'گواهی پزشک معالج مبنی بر خاتمه معالجات و تأیید نقص عضو به انضمام سوابق پزشکی، کلیه رادیوگرافی‌ها و MRI انجام‌شده (مرتبط با موضوع بیمه‌نامه).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY['DISABILITY_ACCIDENT', 'DISABILITY_ILLNESS']::TEXT[], 38, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'insured_id_national_card', 'تصویر شناسنامه / کارت ملی بیمه‌شده.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], 39, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'driving_license', 'تصویر گواهینامه رانندگی متناسب با وسیله نقلیه و معتبر در زمان وقوع حادثه (در صورتی که بیمه‌شده رانندگی وسیله نقلیه را به عهده داشته است).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 40, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_deductions_3m', 'تصویر لیست کسور حق بیمه بازنشستگی در ماه وقوع حادثه / ماه قبل از آن.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 41, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_list_start_accident', 'تصویر لیست کسور حق بیمه بازنشستگی در زمان شروع پوشش بیمه‌ای بیمه‌شده.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 42, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'personnel_order_payslip', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در ماه وقوع حادثه.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 43, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'personnel_order_start', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در زمان شروع پوشش بیمه‌ای بیمه‌شده.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 44, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'retirement_order_accident', 'حکم بازنشستگی بیمه‌شده که تاریخ بازنشستگی وی در آن درج شده باشد.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL']::TEXT[], ARRAY[]::TEXT[], 45, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'master_list_accident', 'لیست ملاک عمل و الحاقیه مربوطه که به تأیید واحد صدور سرپرستی رسیده باشد (صفحه‌ای که نام بیمه‌شده در آن درج شده باشد).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 46, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'report_voucher_accident', 'گزارش و حواله.', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 47, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;
INSERT INTO "RequiredDocument" ("id", "tenantId", "code", "label", "appliesToTypes", "requiredTypes", "order", "isActive")
SELECT md5(random()::TEXT || clock_timestamp()::TEXT)::UUID::TEXT, t."id", 'policy_copy_accident', 'تصویر بیمه‌نامه و شرایط خصوصی مهر و امضاءشده توسط بیمه‌گذار (برحسب مورد).', ARRAY['DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL', 'DISABILITY_ILLNESS']::TEXT[], ARRAY[]::TEXT[], 48, TRUE
FROM "Tenant" t WHERE t."kind" = 'INSURER'
ON CONFLICT ("tenantId", "code") DO UPDATE SET "label" = EXCLUDED."label", "appliesToTypes" = EXCLUDED."appliesToTypes", "requiredTypes" = EXCLUDED."requiredTypes", "order" = EXCLUDED."order", "isActive" = TRUE;

-- No longer asked for: switched off, re-enable per insurer in Model View.
UPDATE "RequiredDocument" SET "isActive" = FALSE, "order" = 1000 + "order" WHERE "code" IN ('social_security_history', 'beneficiary_iban', 'emergency_115_report', 'insured_iban');
