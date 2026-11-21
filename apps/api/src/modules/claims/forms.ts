import type { ActionKey } from './workflow';

/**
 * «فرم گزارش خسارت ارفاقی» (عمر و حوادث گروهی / انفرادی). One form per request, filled section by section as the
 * case climbs: شعبه (b_*: everything down to «شعبه / مجتمع»), مدیریت ستادی عمر و حوادث (h_*), and — only when ستاد refers the
 * case there — شورای فنی (c_* and the مدیرعامل / هیئت مدیره part, m_*).
 */
export const CONCESSION_KEYS: Record<'BRANCH' | 'HQ' | 'COUNCIL', string[]> = { BRANCH: ['b_'], HQ: ['h_'], COUNCIL: ['c_', 'm_'] };

export const CONCESSION_STATUS: Record<string, string> = {
  BRANCH: 'در حال تکمیل در شعبه', HQ: 'در انتظار مدیریت ستادی عمر و حوادث', SIGNED: 'ثبت شده توسط مدیریت ستادی عمر و حوادث', DONE: 'ثبت شده توسط شورای فنی',
};

/** A desk with a form at its turn registers its section before it moves the case on. */
export const CONCESSION_GATE: Partial<Record<string, { status: string; keys: ActionKey[] }>> = {
  BRANCH: { status: 'BRANCH', keys: ['FORWARD', 'MARK_PAID'] },
  HQ: { status: 'HQ', keys: ['PAY_ORDER', 'REFER_COUNCIL', 'DOWN_FORWARD'] },
  COUNCIL: { status: 'SIGNED', keys: ['PAY_ORDER'] },
};

/**
 * «تطابق شرایط پرونده با بیمه نامه» — شعبه's check of a case before it goes on. Each point is «مورد تأیید است»
 * (OK) or «مورد تأیید نمی‌باشد» (SUSPECT); a point not approved leads to «رد پرونده» with `reason`. For the
 * cause of death, the policy's exclusion that applies (`EXCLUSIONS`) is part of that reason.
 */
export const FRAUD_ITEMS = [
  { key: 'CAUSE_POLICY', label: 'تطابق علت فوت با شرایط خصوصی بیمه نامه', reason: 'عدم تطابق علت فوت با شرایط خصوصی بیمه‌نامه', no: 'مورد تأیید نمی باشد' },
  { key: 'WAITING', label: 'بررسی دوره انتظار', reason: 'عدم احراز دوره انتظار', no: 'مورد تأیید نیست' },
] as const;

/** The policy's exclusions (استثنائات): the one a case falls under is the reason it is rejected. */
export const EXCLUSIONS: { key: string; text: string }[] = [
  { key: 'الف', text: 'خودکشی و یا اقدام به آن.' },
  { key: 'ب', text: 'صدمات بدنی که ‌بیمه‌شده عمداً موجب آن ‌شود.' },
  { key: 'ج', text: 'مستی و یا استعمال هرگونه مواد مخدر و روان گردان.' },
  { key: 'د', text: 'استفاده از داروهای کاهنده هوشیاری و خواب‌آور بدون تجویز پزشک.' },
  { key: 'هـ', text: 'ارتکاب ‌بیمه‌شده به اعمال مجرمانه اعم از مباشرت، مشارکت و یا معاونت در آن.' },
  { key: 'و', text: 'هر نوع دیسک و یا فتق ‌بیمه‌شده.' },
  { key: 'ز', text: 'بیماری و ابتلا به جنون ‌بیمه‌شده مگر آن که ابتلا به جنون ناشی از تحقق خطر موضوع این بیمه باشد.' },
  { key: 'ح', text: 'فوت ‌بیمه‌شده به علت حادثه ناشی از عمد ذی‌نفع (اعم از مباشرت، مشارکت و یا معاونت). در این صورت ‌بیمه‌گر فقط متعهد به پرداخت سهم سایر افراد ذی‌نفع در سرمایه بیمه خواهد بود.' },
  { key: 'ط', text: 'شورش، انقلاب، بلوا، اعتصاب، قیام، آشوب، کودتا و اقدامات احتیاطی مقامات نظامی و انتظامی.' },
  { key: 'ی', text: 'زمین‌لرزه، آتش‌فشان و فعل و انفعالات هسته‌ای.' },
  { key: 'ک', text: 'ورزش‌های رزمی و حرفه‌ای، شکار، سوارکاری، قایق‌رانی، هدایت موتورسیکلت، هدایت و یا سرنشینی هواپیمای آموزشی، اکتشافی و غیرتجاری، هدایت و یا سرنشینی اتومبیل کورسی (مسابقه‌ای)، هدایت و یا سرنشینی هلیکوپتر، غواصی، پرش با چتر نجات و هدایت کایت یا سایر وسائل پرواز بدون موتور.' },
  { key: 'ل', text: 'بیمه‌شده نباید در تحقق خطر بیمه‌شده مشارکت داشته باشد.' },
  { key: 'م', text: 'بیمه‌گر می‌تواند با ارسال اخطار کتبی ۱۰ روزه پوشش بیمه‌ای موضوع بند مذکور را لغو نماید.' },
  { key: 'ن', text: 'حوادث ناشی از رانندگی توسط شخص بیمه‌شده در صورتی که دارای گواهینامه معتبر و متناسب با نوع وسیله نقلیه مورد استفاده نباشد.' },
];
/** «رد پرونده»: the reasons شعبه may pick (formerly «غیر قابل پرداخت» under عودت). */
export const REJECT_REASONS = ['حادثه خارج از مدت اعتبار بیمه‌نامه رخ داده است', 'علت خسارت از استثنائات بیمه‌نامه است'];
/** «دعوت به معاینه»: what شعبه asks the پزشک معتمد (formerly a group under عودت). */
export const EXAM_ITEMS = ['نیاز به معاینهٔ بیمه‌شده توسط پزشک معتمد', 'تعیین درصد نقص عضو توسط پزشک معتمد'];
/** Groups of «عودت» that are no longer reasons for a return (they moved to «رد پرونده» and «دعوت به معاینه»). */
export const NOT_RETURN_GROUPS = ['غیر قابل پرداخت', 'دعوت به معاینه'];
/**
 * «دعوت به معاینه»: only for a حوادث case of نقص عضو (the insured is examined in person, reached through the
 * «شماره تماس قابل دسترس» given at filing).
 */
export function examAllowed(line: string | null | undefined, claimType: string | null | undefined): boolean {
  return claimType === 'DISABILITY_ACCIDENT' && isAccidentKind(line, claimType);
}

/** «تبصره ۱»: printed between ک and ل on the policy. */
export const EXCLUSIONS_NOTE = 'تبصره ۱– خطرات مندرج دربندهای ط، ی و ک با موافقت کتبی ‌بیمه‌گر و اخذ ‌حق‌بیمه مربوطه قابل پوشش است و برای پوشش بند ط رعایت موارد زیر ضروری است:';

/** A حوادث case (by its نوع بیمه‌نامه, else its نوع پرونده): سرمایه حادثه applies; otherwise عمر and سرمایه فوت. */
export function isAccidentKind(line: string | null | undefined, claimType: string | null | undefined): boolean {
  return doctorFormOf({ line, claimType }) === 'ACCIDENT';
}

/** «فرم اظهار نظر پزشک معتمد»: the حوادث form for accident kinds and cases, the عمر form otherwise. */
export function doctorFormOf(c: { line?: string | null; claimType?: string | null }): 'LIFE' | 'ACCIDENT' {
  if (c.line === 'ACCIDENT' || c.line === 'ACCIDENT_INDIVIDUAL') return 'ACCIDENT';
  if (c.line === 'LIFE' || c.line === 'CREDIT_LIFE') return 'LIFE';
  return c.claimType && ACCIDENT_COST[c.claimType] ? 'ACCIDENT' : 'LIFE';
}

/** «نوع هزینه خسارت» of the ارفاقی form for a case type (prefill). */
export const COST_TYPE: Record<string, string> = {
  DEATH_ILLNESS: 'فوت به هر علت', DISABILITY_ILLNESS: 'از کارافتادگی ناشی از بیماری',
};
const ACCIDENT_COST: Record<string, string> = {
  DEATH_ACCIDENT: 'فوت ناشی از حوادث', DISABILITY_ACCIDENT: 'نقص عضو ناشی از حوادث', MEDICAL_ACCIDENT: 'هزینه پزشکی ناشی از حوادث',
  DAILY_GENERAL: 'غرامت روزانه عمومی', DAILY_HOSPITAL: 'غرامت روزانه بیمارستانی',
};
Object.assign(COST_TYPE, ACCIDENT_COST);
