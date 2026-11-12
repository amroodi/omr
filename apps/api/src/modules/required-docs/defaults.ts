// نوع پرونده codes. A stored code never changes meaning: labels live in Model View (workflow.ts).
const DEATH_ANY = 'DEATH_ILLNESS'; // فوت به هر علت
const DEATH_ACC = 'DEATH_ACCIDENT'; // فوت بر اثر حادثه
const DIS_ILL = 'DISABILITY_ILLNESS'; // از کار افتادگی دائم و کامل ناشی از بیماری
const DIS_ACC = 'DISABILITY_ACCIDENT'; // نقص عضو و از کار افتادگی بر اثر حادثه
const MEDICAL = 'MEDICAL_ACCIDENT'; // جبران هزینه‌های ناشی از حادثه
const DAILY_GEN = 'DAILY_GENERAL'; // غرامت روزانه عمومی
const DAILY_HOSP = 'DAILY_HOSPITAL'; // غرامت روزانه بیمارستانی

const DEATH = [DEATH_ANY, DEATH_ACC];
const ACCIDENT = [DIS_ACC, MEDICAL, DAILY_GEN, DAILY_HOSP];
const INJURY = [...ACCIDENT, DIS_ILL];

export interface DefaultDoc {
  code: string;
  label: string;
  appliesToTypes: string[]; // the نوع پرونده that list it
  requiredTypes: string[]; // of those, where the case can't be sent without it; the rest are «برحسب نیاز»
  order: number;
}

/**
 * Default catalog of a new INSURER, editable per insurer in Model View › مدارک. From Alborz's checklists
 * 646/01 (فوت) and 645/03 (نقص عضو / ازکارافتادگی / هزینه پزشکی) and clauses ه-۱ and ه-۲ of the policy
 * conditions, which decide what is required. Codes of the earlier catalog stay where the document is the
 * same, so files already uploaded keep their slot. Alborz gave no list for غرامت روزانه or illness
 * disability: those take the 645 items that can apply.
 */
const rows: [string, string, string[], string[]?][] = [
  // ── فوت (646/01) ──
  ['loss_notice_death', 'نامه اعلام خسارت بیمه‌گزار / معرف / ذینفع.', DEATH],
  ['coverage_form_death', 'فرم تکمیل‌شده تعیین وضعیت پوشش بیمه‌ای بیمه‌شده توسط واحد صدور و تأیید واحد صدور سرپرستی.', DEATH],
  ['police_initial_report', 'گزارش مشروح حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و تأیید گردیده و نام بیمه‌شده و تاریخ دقیق وقوع حادثه در آن ذکر شده باشد (ممهور به مهر مراجع ذی‌صلاح).', DEATH],
  ['workplace_report_death', 'گزارش مشروح حادثه با ذکر نام بیمه‌شده و تاریخ وقوع حادثه که در محل کار تنظیم و به تأیید کارشناس وزارت کار یا سازمان تأمین اجتماعی و یا واحد ایمنی و بهداشت کار بیمه‌گزار رسیده باشد.', DEATH],
  ['traffic_crash_sketch', 'گزارش و کروکی نیروهای انتظامی درخصوص تصادفات و سوانح رانندگی.', DEATH],
  ['witness_statement_death', 'استشهاد محلی تنظیمی مبنی بر شرح حادثه با ذکر نام بیمه‌شده و تاریخ دقیق وقوع حادثه و آدرس و شماره تلفن شهود که به تأیید شورای محل / مسجد محل / مقامات انتظامی رسیده باشد.', DEATH],
  ['quarrel_verdict_death', 'رأی مقامات انتظامی و قضایی مبنی بر مقصر نبودن بیمه‌شده درخصوص حوادث ناشی از نزاع و درگیری.', DEATH],
  ['physician_death_cert', 'گواهی پزشک معالج یا پزشک قانونی مبنی بر علت فوت.', DEATH, DEATH],
  ['court_verdict_death', 'رأی نهایی دادگاه مبنی بر علت تامه فوت (برحسب مورد).', DEATH],
  ['autopsy_forensic', 'گزارش معاینه جسد (برحسب نیاز).', DEATH],
  ['death_certificate', 'تصویر خلاصه رونوشت وفات.', DEATH, DEATH],
  ['burial_permit_cause', 'تصویر جواز دفن (پروانه دفن).', DEATH, DEATH],
  ['deceased_id_national_card', 'تصویر کلیه صفحات شناسنامه باطل‌شده و کارت ملی متوفی.', DEATH, DEATH],
  ['inheritance_cert', 'گواهی حصر وراثت که در آن سهم‌الارث هر یک از وراث قانونی مشخص شده باشد (با ارزش نامحدود و یا برابر با سرمایه فوت).', DEATH, DEATH],
  ['beneficiary_form', 'اصل فرم تعیین ذینفع تکمیل‌شده توسط بیمه‌شده (ممهور به مهر بیمه‌گزار).', DEATH, DEATH],
  ['no_beneficiary_form_letter', 'نامه بیمه‌گزار مبنی بر پر نکردن فرم ذینفع.', DEATH],
  ['medical_questionnaire', 'فرم پرسشنامه پزشکی بیمه‌شده که در زمان حیات تکمیل گردیده است (ممهور به مهر بیمه‌گزار).', DEATH],
  ['heirs_id_national_card', 'تصویر کلیه صفحات شناسنامه وراث قانونی طبق گواهی حصر وراثت و یا ذینفع‌های مشخص‌شده در فرم تعیین ذینفع.', DEATH, DEATH],
  ['iban_printout', 'تصویر پرینت شماره شبا.', DEATH],
  ['driver_license_valid', 'تصویر گواهینامه رانندگی متناسب با وسیله نقلیه و معتبر در زمان وقوع فوت (در صورتی که بیمه‌شده رانندگی وسیله نقلیه را به عهده داشته است).', DEATH],
  ['passport_deceased', 'تصویر کلیه صفحات گذرنامه متوفی که در آن تاریخ ورود و خروج از کشور قید شده باشد.', DEATH],
  ['martyr_cert', 'گواهی شهادت متوفی (در صورت فوت بیمه‌شده در عتبات عالیات).', DEATH],
  ['loan_form', 'فرم استعلام شرایط وام (برای بیمه‌های عمر مانده بدهکار).', DEATH],
  ['retirement_list_death', 'تصویر لیست کسور حق بیمه بازنشستگی در ماه فوت بیمه‌شده / ماه قبل از آن.', DEATH],
  ['retirement_list_start_death', 'تصویر لیست کسور حق بیمه بازنشستگی در زمان شروع پوشش بیمه‌ای بیمه‌شده.', DEATH],
  ['last_personnel_order', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در ماه فوت.', DEATH],
  ['employment_contract_payslips', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در زمان شروع پوشش بیمه‌ای بیمه‌شده.', DEATH],
  ['retirement_order_death', 'حکم بازنشستگی / از کار افتادگی دائم و کامل بیمه‌شده که تاریخ بازنشستگی / از کار افتادگی وی در آن درج شده باشد.', [...DEATH, DIS_ILL]],
  ['master_list_death', 'لیست ملاک عمل و الحاقیه مربوطه که به تأیید واحد صدور سرپرستی رسیده باشد (صفحه‌ای که نام بیمه‌شده در آن درج شده باشد).', DEATH],
  ['report_voucher_death', 'گزارش و حواله.', DEATH],
  ['policy_copy_death', 'تصویر بیمه‌نامه و شرایط خصوصی مهر و امضاءشده توسط بیمه‌گزار (برحسب مورد).', DEATH],

  // ── نقص عضو / ازکارافتادگی / هزینه پزشکی (645/03) ──
  ['loss_notice_accident', 'نامه اعلام خسارت بیمه‌گزار / بیمه‌شده / معرف.', INJURY],
  ['coverage_form_accident', 'فرم تکمیل‌شده تعیین وضعیت پوشش بیمه‌ای بیمه‌شده توسط واحد صدور و تأیید واحد صدور سرپرستی.', INJURY],
  ['accident_report', 'گزارش مشروح حادثه که توسط مراجع ذی‌صلاح انتظامی یا قضایی تنظیم و تأیید گردیده و نام بیمه‌شده و تاریخ دقیق وقوع حادثه در آن ذکر شده باشد (ممهور به مهر مراجع مذکور).', ACCIDENT],
  ['traffic_report_accident', 'گزارش و کروکی نیروهای انتظامی درخصوص تصادفات و سوانح رانندگی.', ACCIDENT],
  ['workplace_report_accident', 'گزارش مشروح حادثه با ذکر نام بیمه‌شده و تاریخ وقوع حادثه که در محل کار تنظیم و به تأیید کارشناس وزارت کار یا سازمان تأمین اجتماعی و یا واحد ایمنی و بهداشت کار بیمه‌گزار رسیده باشد (برای حوادث ناشی از کار).', ACCIDENT],
  ['witness_statement_accident', 'استشهاد محلی تنظیمی مبنی بر شرح حادثه با ذکر نام بیمه‌شده و تاریخ دقیق وقوع حادثه و آدرس و شماره تلفن شهود که به تأیید شورای محل / مسجد محل / مقامات انتظامی رسیده باشد.', ACCIDENT],
  ['quarrel_verdict_accident', 'رأی مقامات انتظامی و قضایی مبنی بر مقصر نبودن بیمه‌شده درخصوص حوادث ناشی از نزاع و درگیری.', ACCIDENT],
  ['first_medical_facility_cert', 'گواهی اولین مرجع درمانی که بیمه‌شده بلافاصله پس از مصدومیت به آن مراجعه نموده است.', ACCIDENT, ACCIDENT],
  ['disability_medical_cert', 'گواهی پزشک معالج مبنی بر خاتمه معالجات و تأیید نقص عضو به انضمام سوابق پزشکی، کلیه رادیوگرافی‌ها و MRI انجام‌شده (مرتبط با موضوع بیمه‌نامه).', INJURY, [DIS_ACC, DIS_ILL]],
  ['insured_id_national_card', 'تصویر شناسنامه / کارت ملی بیمه‌شده.', INJURY, INJURY],
  ['driving_license', 'تصویر گواهینامه رانندگی متناسب با وسیله نقلیه و معتبر در زمان وقوع حادثه (در صورتی که بیمه‌شده رانندگی وسیله نقلیه را به عهده داشته است).', ACCIDENT],
  ['retirement_deductions_3m', 'تصویر لیست کسور حق بیمه بازنشستگی در ماه وقوع حادثه / ماه قبل از آن.', INJURY],
  ['retirement_list_start_accident', 'تصویر لیست کسور حق بیمه بازنشستگی در زمان شروع پوشش بیمه‌ای بیمه‌شده.', INJURY],
  ['personnel_order_payslip', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در ماه وقوع حادثه.', INJURY],
  ['personnel_order_start', 'حکم کارگزینی / قرارداد کاری / فیش حقوقی بیمه‌شده در زمان شروع پوشش بیمه‌ای بیمه‌شده.', INJURY],
  ['retirement_order_accident', 'حکم بازنشستگی بیمه‌شده که تاریخ بازنشستگی وی در آن درج شده باشد.', ACCIDENT],
  ['master_list_accident', 'لیست ملاک عمل و الحاقیه مربوطه که به تأیید واحد صدور سرپرستی رسیده باشد (صفحه‌ای که نام بیمه‌شده در آن درج شده باشد).', INJURY],
  ['report_voucher_accident', 'گزارش و حواله.', INJURY],
  ['policy_copy_accident', 'تصویر بیمه‌نامه و شرایط خصوصی مهر و امضاءشده توسط بیمه‌گزار (برحسب مورد).', INJURY],
];

export const DEFAULT_REQUIRED_DOCS: DefaultDoc[] = rows.map(([code, label, appliesToTypes, requiredTypes], i) => ({
  code, label, appliesToTypes, requiredTypes: requiredTypes ?? [], order: i + 1,
}));

/** Codes of the earlier catalog that Alborz's lists no longer ask for: switched off, their files kept under «سایر مدارک». */
export const RETIRED_DOC_CODES = ['social_security_history', 'beneficiary_iban', 'emergency_115_report', 'insured_iban'];

/**
 * «فرم تعیین/تغییر ذینفع»: دارد → the form and its people; ندارد → the انحصار وراثت certificate (and the
 * بیمه‌گزار's letter that no form was filled) instead. The documents a case's choice takes off its checklist.
 */
/** Every document about who receives the money (ذینفع form, حصر وراثت, their IDs and شبا), in the default and Alborz lists. */
export const BENEFICIARY_DOC_CODES = ['beneficiary_form', 'inheritance_cert', 'no_beneficiary_form_letter', 'heirs_id_national_card', 'iban_printout',
  'li_beneficiary_form', 'li_heirs_id', 'li_heirs_iban', 'da_crash_beneficiary_form', 'da_crash_heirs_id', 'da_crash_heirs_iban'];
export function beneficiaryHiddenDocs(beneficiaryType: string | null | undefined): string[] {
  if (beneficiaryType === 'ذینفع قانونی') return ['inheritance_cert', 'no_beneficiary_form_letter'];
  if (beneficiaryType === 'وراث قانونی') return ['beneficiary_form'];
  // Paid to the بیمه‌گزار: no ذینفع / وراث documents (it pays the people itself).
  if (beneficiaryType === 'بیمه گزار') return [...BENEFICIARY_DOC_CODES];
  return [];
}
