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
