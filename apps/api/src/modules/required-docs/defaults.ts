import { ClaimType } from '@prisma/client';

const ILLNESS: ClaimType = 'DEATH_ILLNESS';
const ACCIDENT: ClaimType = 'DEATH_ACCIDENT';
const DISABILITY: ClaimType = 'DISABILITY_ACCIDENT';

/**
 * Default required-document catalog seeded for a new INSURER. Transcribed from the insurer's
 * claim-document checklist: death from illness (ج-۱), death from accident (ج-۲), and
 * disability/dismemberment from accident (ج-۴). Each document lists the claim types that require
 * it. Business-editable afterwards via the API/panel — no code change needed.
 *
 * Note on mapping: the police report (کلانتری/انتظامی), EMS-115 report, final forensic opinion and
 * the traffic-crash items apply to ACCIDENTAL death only — a natural/illness death cannot produce
 * them, so requiring them on an illness claim would make it impossible to complete.
 */
export const DEFAULT_REQUIRED_DOCS: {
  code: string;
  label: string;
  appliesToTypes: ClaimType[];
  order: number;
}[] = [
  // ── Core death-claim documents (both death-from-illness ج-۱ and death-from-accident ج-۲) ──
  { code: 'last_personnel_order', label: 'آخرین حکم کارگزینی مربوط به قبل از فوت، با مهر و تأیید بیمه‌گزار (جهت کارکنان رسمی).', appliesToTypes: [ILLNESS, ACCIDENT], order: 1 },
  { code: 'employment_contract_payslips', label: 'قرارداد کاری بین بیمه‌شده و بیمه‌گزار، معتبر در تاریخ وقوع فوت و تاریخ شروع پوشش بیمه‌ای، با مهر و تأیید بیمه‌گزار، به‌انضمام فیش‌های حقوقی چهار ماه منتهی به فوت بیمه‌شده (جهت کارکنان قراردادی).', appliesToTypes: [ILLNESS, ACCIDENT], order: 2 },
  { code: 'social_security_history', label: 'پرینت استعلام سوابق تأمین اجتماعی بیمه‌شده (تا زمان فوت) با مهر و تأیید سازمان تأمین اجتماعی و یا بیمه‌گزار(جهت کارکنان قراردادی).', appliesToTypes: [ILLNESS, ACCIDENT], order: 3 },
  { code: 'deceased_id_national_card', label: 'تصویر برابر با اصل کلیه صفحات شناسنامه باطل‌شده بانضمام کارت ملی بیمه‌شده.', appliesToTypes: [ILLNESS, ACCIDENT], order: 4 },
  { code: 'death_certificate', label: 'تصویر برابر با اصل گواهی وفات.', appliesToTypes: [ILLNESS, ACCIDENT], order: 5 },
  { code: 'burial_permit_cause', label: 'تصویر برابر با اصل جواز دفن با ذکر علت فوت که توسط پزشک معالج یا پزشک قانونی صادر شده باشد.', appliesToTypes: [ILLNESS, ACCIDENT], order: 6 },
  { code: 'beneficiary_form', label: 'اصل فرم تعیین ذینفع بدون خط‌خوردگی و با امضاء بیمه‌شده و با مهر تأیید بیمه‌گزار.', appliesToTypes: [ILLNESS, ACCIDENT], order: 7 },
  { code: 'inheritance_cert', label: 'در صورت فقدان و یا عدم تکمیل فرم ذینفع، ضمن اعلام کتبی توسط بیمه‌گزار، تصویر برابر با اصل گواهی انحصار وراثت با ارزش نامحدود و با ذکر درصد سهم هر یک از وراث.', appliesToTypes: [ILLNESS, ACCIDENT], order: 8 },
  { code: 'heirs_id_national_card', label: 'تصویر برابر با اصل صفحه اول شناسنامه و کارت ملی کلیه وراث یا ذینفع‌ها.', appliesToTypes: [ILLNESS, ACCIDENT], order: 9 },
  { code: 'beneficiary_iban', label: 'پرینت شماره شبای کلیه وراث یا ذینفع‌ها با مهر بانک مربوطه.', appliesToTypes: [ILLNESS, ACCIDENT], order: 10 },

  // ── Additional for accidental death (ج-۲) — not applicable to natural/illness deaths ──
  { code: 'police_initial_report', label: 'تصویر برابر با اصل صورتجلسه اولیه کلانتری و یا گزارش مراجع انتظامی که نام بیمه‌شده، تاریخ حادثه و علت وقوع در آن قید شده باشد.', appliesToTypes: [ACCIDENT], order: 11 },
  { code: 'emergency_115_report', label: 'تصویر برابر با اصل گزارش اورژانس ۱۱۵ مربوط به زمان فوت.', appliesToTypes: [ACCIDENT], order: 12 },
  { code: 'autopsy_forensic', label: 'تصویر برابر با اصل شرح معاینه جسد و نظریه نهایی پزشکی قانونی در خصوص علت تامه فوت.', appliesToTypes: [ACCIDENT], order: 13 },
  { code: 'traffic_crash_sketch', label: 'کروکی پلیس راهور (در صورت وقوع سانحه تصادف.)', appliesToTypes: [ACCIDENT], order: 14 },
  { code: 'driver_license_valid', label: 'تصویر برابر با اصل گواهینامه رانندگی معتبر و متناسب با وسیله نقلیه، در صورتی که رانندگی بر عهده بیمه‌شده بوده است (در سانحه تصادف).', appliesToTypes: [ACCIDENT], order: 15 },

  // ── Disability/dismemberment from accident (ج-۴) ──
  { code: 'accident_report', label: '.گزارش مشروح حادثه تنظیم‌شده توسط مراجع ذی‌صلاح', appliesToTypes: [DISABILITY], order: 16 },
  { code: 'disability_medical_cert', label: 'گواهی پزشک معالج/قانونی مبنی بر خاتمه معالجات و تأیید نقص عضو/ازکارافتادگی بانضمام سوابق پزشکی.، CT اسکن، MRI و کلیه رادیوگرافی‌ها', appliesToTypes: [DISABILITY], order: 17 },
  { code: 'first_medical_facility_cert', label: 'گواهی اولین مرجع درمانی که بیمه‌شده بلافاصله پس از حادثه به آن مراجعه نموده است.', appliesToTypes: [DISABILITY], order: 18 },
  { code: 'insured_id_national_card', label: 'رونوشت برابر اصل شناسنامه و کارت ملی بیمه‌شده.', appliesToTypes: [DISABILITY], order: 19 },
  { code: 'personnel_order_payslip', label: 'رونوشت برابر اصل آخرین حکم کارگزینی و فیش حقوقی بیمه‌شده.', appliesToTypes: [DISABILITY], order: 20 },
  { code: 'retirement_deductions_3m', label: 'لیست کسورات بازنشستگی ۳ ماه آخر منتهی به تاریخ وقوع خسارت.', appliesToTypes: [DISABILITY], order: 21 },
  { code: 'driving_license', label: 'رونوشت برابر اصل گواهینامه رانندگی بیمه‌شده (در صورتی که راننده وسیله نقلیه بوده).', appliesToTypes: [DISABILITY], order: 22 },
];
