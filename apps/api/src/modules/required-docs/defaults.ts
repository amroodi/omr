import { ClaimType } from '@prisma/client';

const ILLNESS: ClaimType = 'DEATH_ILLNESS';
const ACCIDENT: ClaimType = 'DEATH_ACCIDENT';
const DISABILITY: ClaimType = 'DISABILITY_ACCIDENT';

/**
 * Default required-document catalog seeded for a new INSURER, transcribed from the policy
 * contract (clause ج): death from illness (ج-۱), death from accident (ج-۲), and
 * disability/dismemberment from accident (ج-۴). Each document lists the claim types that require
 * it. Business-editable afterwards via the API — no code change needed.
 */
export const DEFAULT_REQUIRED_DOCS: {
  code: string;
  label: string;
  appliesToTypes: ClaimType[];
  order: number;
}[] = [
  // ── Common to death-from-illness and death-from-accident ──
  { code: 'last_personnel_order', label: 'آخرین حکم کارگزینی قبل از فوت (ممهور به مهر و امضای بیمه‌گزار)', appliesToTypes: [ILLNESS, ACCIDENT], order: 1 },
  { code: 'employment_contract_ss', label: 'قرارداد کاری بیمه‌شده و بیمه‌گزار معتبر در تاریخ فوت و شروع پوشش + پرینت سوابق تأمین اجتماعی (کارکنان قراردادی)', appliesToTypes: [ILLNESS, ACCIDENT], order: 2 },
  { code: 'deceased_id_national_card', label: 'تصویر برابر اصل کلیه صفحات شناسنامه باطل‌شده و کارت ملی بیمه‌شده', appliesToTypes: [ILLNESS, ACCIDENT], order: 3 },
  { code: 'burial_permit', label: 'تصویر برابر اصل جواز دفن', appliesToTypes: [ILLNESS, ACCIDENT], order: 4 },
  { code: 'death_cert_cause', label: 'تصویر برابر اصل گواهی وفات با ذکر علت فوت (پزشک معالج یا پزشکی قانونی)', appliesToTypes: [ILLNESS, ACCIDENT], order: 5 },
  { code: 'beneficiary_form', label: 'اصل فرم تعیین/تغییر ذینفع بدون خط‌خوردگی (امضای بیمه‌شده و تأیید بیمه‌گزار)', appliesToTypes: [ILLNESS, ACCIDENT], order: 6 },
  { code: 'inheritance_cert', label: 'تصویر برابر اصل انحصار وراثت نامحدود با درصد سهم وراث (در صورت نبود/مخدوش بودن فرم ذینفع)', appliesToTypes: [ILLNESS, ACCIDENT], order: 7 },
  { code: 'heirs_id_national_card', label: 'تصویر برابر اصل صفحه اول شناسنامه و کارت ملی وراث/ذینفع‌ها', appliesToTypes: [ILLNESS, ACCIDENT], order: 8 },
  { code: 'beneficiary_iban', label: 'پرینت شماره شبای هر یک از ذینفع‌ها با مهر بانک', appliesToTypes: [ILLNESS, ACCIDENT], order: 9 },

  // ── Death-from-accident only (ج-۲) ──
  { code: 'accident_report_police', label: 'تصویر برابر اصل گزارش مشروح حادثه (مراجع انتظامی/قضایی) با نام بیمه‌شده و تاریخ دقیق + کروکی پلیس راهور و صورتجلسه کلانتری در تصادف رانندگی', appliesToTypes: [ACCIDENT], order: 10 },
  { code: 'work_accident_report', label: 'گزارش مشروح حادثه در محل کار با تأیید وزارت کار/تأمین اجتماعی/واحد ایمنی و بهداشت (حادثه ناشی از کار)', appliesToTypes: [ACCIDENT], order: 11 },
  { code: 'autopsy_forensic', label: 'تصویر برابر اصل شرح معاینه جسد و نظریه نهایی پزشکی قانونی درباره علت تامه فوت', appliesToTypes: [ACCIDENT], order: 12 },

  // ── Disability/dismemberment from accident (ج-۴) ──
  { code: 'accident_report', label: 'گزارش مشروح حادثه تنظیم‌شده توسط مراجع ذی‌صلاح', appliesToTypes: [DISABILITY], order: 13 },
  { code: 'disability_medical_cert', label: 'گواهی پزشک معالج/قانونی مبنی بر خاتمه معالجات و تأیید نقص عضو/ازکارافتادگی + سوابق پزشکی، CT اسکن، MRI و کلیه رادیوگرافی‌ها', appliesToTypes: [DISABILITY], order: 14 },
  { code: 'first_medical_facility_cert', label: 'گواهی اولین مرجع درمانی که بیمه‌شده بلافاصله پس از حادثه به آن مراجعه کرده است', appliesToTypes: [DISABILITY], order: 15 },
  { code: 'insured_id_national_card', label: 'رونوشت برابر اصل شناسنامه و کارت ملی بیمه‌شده', appliesToTypes: [DISABILITY], order: 16 },
  { code: 'personnel_order_payslip', label: 'رونوشت برابر اصل آخرین حکم کارگزینی و فیش حقوقی بیمه‌شده', appliesToTypes: [DISABILITY], order: 17 },
  { code: 'retirement_deductions_3m', label: 'لیست کسورات بازنشستگی ۳ ماه آخر منتهی به تاریخ وقوع خسارت', appliesToTypes: [DISABILITY], order: 18 },
  { code: 'driving_license', label: 'رونوشت برابر اصل گواهینامه رانندگی بیمه‌شده (در صورتی که راننده وسیله نقلیه بوده)', appliesToTypes: [DISABILITY], order: 19 },
];
