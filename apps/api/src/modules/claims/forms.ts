import type { ActionKey } from './workflow';

/**
 * «فرم گزارش خسارت ارفاقی» (عمر و حوادث گروهی / انفرادی). One form per request, filled section by section as the
 * case climbs: شعبه (b_*: everything down to «شعبه / مجتمع»), مدیریت ستاد (h_*), and — only when ستاد refers the
 * case there — شورای فنی (c_* and the مدیرعامل / هیئت مدیره part, m_*).
 */
export const CONCESSION_KEYS: Record<'BRANCH' | 'HQ' | 'COUNCIL', string[]> = { BRANCH: ['b_'], HQ: ['h_'], COUNCIL: ['c_', 'm_'] };

export const CONCESSION_STATUS: Record<string, string> = {
  BRANCH: 'در حال تکمیل در شعبه', HQ: 'در انتظار مدیریت ستاد', SIGNED: 'ثبت شده توسط مدیریت ستاد', DONE: 'ثبت شده توسط شورای فنی',
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
  { key: 'الف', text: 'خودكشي و يا اقدام به آن.' },
  { key: 'ب', text: 'صدمات بدني كه ‌بيمه‌شده عمداً موجب آن ‌شود.' },
  { key: 'ج', text: 'مستي و يا استعمال هرگونه مواد مخدر و روان گردان.' },
  { key: 'د', text: 'استفاده از داروهاي كاهنده هوشياري و خواب‌آور بدون تجويز پزشك.' },
  { key: 'هـ', text: 'ارتكاب ‌بيمه‌شده به اعمال مجرمانه اعم از مباشرت، مشاركت و يا معاونت در آن.' },
  { key: 'و', text: 'هر نوع ديسك و يا فتق ‌بيمه‌شده.' },
  { key: 'ز', text: 'بيماري و ابتلا به جنون ‌بيمه‌شده مگر آن كه ابتلا به جنون ناشي از تحقق خطر موضوع اين بيمه باشد.' },
  { key: 'ح', text: 'فوت ‌بيمه‌شده به علت حادثه ناشي از عمد ذي‌نفع (اعم از مباشرت، مشاركت و يا معاونت). در اين صورت ‌بيمه‌گر فقط متعهد به پرداخت سهم ساير افراد ذي‌نفع در سرمايه بيمه خواهد بود.' },
  { key: 'ط', text: 'شورش، انقلاب، بلوا، اعتصاب، قيام، آشوب، كودتا و اقدامات احتياطي مقامات نظامي و انتظامي.' },
  { key: 'ی', text: 'زمين‌لرزه، آتش‌فشان و فعل و انفعالات هسته‌اي.' },
  { key: 'ک', text: 'ورزش‌هاي رزمي و حرفه‌اي، شكار، سواركاري، قايق‌راني، هدايت موتورسيكلت، هدايت و يا سرنشيني هواپيماي آموزشي، اكتشافي و غيرتجاري، هدايت و يا سرنشيني اتومبيل كورسي (مسابقه‌اي)، هدايت و يا سرنشيني هليكوپتر، غواصي، پرش با چتر نجات و هدايت كايت يا ساير وسائل پرواز بدون موتور.' },
  { key: 'ل', text: 'بيمه‌شده نبايد در تحقق خطر بيمه‌شده مشاركت داشته باشد.' },
  { key: 'م', text: 'بيمه‌گر مي‌تواند با ارسال اخطار كتبي ۱۰ روزه پوشش بيمه‌اي موضوع بند مذكور را لغو نمايد.' },
  { key: 'ن', text: 'حوادث ناشي از رانندگي توسط شخص بيمه‌شده در صورتي كه داراي گواهينامه معتبر و متناسب با نوع وسيله نقليه مورد استفاده نباشد.' },
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

/** «تبصره ۱»: printed between ك and ل on the policy. */
export const EXCLUSIONS_NOTE = 'تبصره ۱– خطرات مندرج دربندهاي ط، ي و ك با موافقت كتبي ‌بيمه‌گر و اخذ ‌حق‌بيمه مربوطه قابل پوشش است و براي پوشش بند ط رعايت موارد زير ضروري است:';

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
