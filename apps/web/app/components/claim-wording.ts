/** What a filing form calls things, by the بیمه‌نامه's line and the نوع پرونده. */

/** عمر covers death and disability; حوادث (and no policy chosen yet) covers injury and death. */
export const insuredNameLabel = (line?: string | null) =>
  (line === 'LIFE' ? 'نام بیمه‌شده (متوفی/از کار افتاده)' : 'نام بیمه‌شده (مصدوم/متوفی)');

/** نوع بیمه‌شده of a case. */
export const INSURED_RELATIONS: Record<string, string> = { MAIN: 'اصلی', SPOUSE: 'همسر', CHILD: 'فرزند', FATHER: 'پدر', MOTHER: 'مادر', OTHER: 'سایر' };

export const EVENT_DATE_LABEL = 'تاریخ وقوع';
/**
 * The date field of panel 1 for a نوع پرونده: «تاریخ فوت» for any death (a type marked «پروندهٔ فوت»:
 * فوت به هر علت, فوت بر اثر حادثه…), «تاریخ حادثه» for every other type (از کار افتادگی ناشی از بیماری too).
 */
export const eventDateLabel = (t?: { death?: boolean } | null) => (t?.death ? 'تاریخ فوت' : 'تاریخ حادثه');

export const CAUSE_LABEL = 'علت خسارت';

/** Who filed a case («ثبت‌کننده»), as the server reports it. */
export interface Filer { kind: string; role: string; name: string | null; org: string | null; orgCode: string | null; branch: string | null; branchCode: string | null }
/** «علی رضایی — کارشناس کارگزاری دامون (کد ۱۲۳) · شعبه مرکزی (کد ۱۰۰۱)» */
export function filerText(f?: Filer | null): string | null {
  if (!f) return null;
  const org = f.org ? `${f.org}${f.orgCode ? ` (کد ${f.orgCode})` : ''}` : '';
  const branch = f.branch ? `شعبه ${f.branch}${f.branchCode ? ` (کد ${f.branchCode})` : ''}` : '';
  return [`${f.name || '—'} — ${f.role}${org ? ` ${org}` : ''}`, branch].filter(Boolean).join(' · ');
}

/** «جنسیت» of the insured, for «آقای» / «خانم» before the name. */
export const GENDERS: Record<string, string> = { MALE: 'مرد', FEMALE: 'زن' };
/**
 * The insured's name as shown: «مرحوم» for a death, then «آقای» / «خانم» when the gender is known —
 * «مرحوم خانم فلانی», «آقای فلانی». A name already written with them is left alone.
 */
export function personTitle(name: string | null | undefined, opts: { death?: boolean; gender?: string | null }): string {
  const n = (name ?? '').trim();
  if (!n || n === '—') return n || '';
  let core = n.replace(/^مرحوم(ه)?\s+/, '');
  const titled = /^(آقای|خانم)\s/.test(core);
  if (!titled && opts.gender === 'MALE') core = `آقای ${core}`;
  if (!titled && opts.gender === 'FEMALE') core = `خانم ${core}`;
  return opts.death || /^مرحوم/.test(n) ? `مرحوم ${core}` : core;
}

/** A second, required choice some causes ask for (Model View), e.g. «نوع حادثه» after «فوت در اثر حادثه…». */
export interface CaseDetail { label: string; options: string[]; causes: string[] }
/** «علت» texts compared loosely, as the server does (spaces, ZWNJ, kashida, quotes, ي/ك, «گذار»/«گزار»). */
export const normCause = (s?: string | null) =>
  (s ?? '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/گذار/g, 'گزار').replace(/[\s\u200c\u0640"'«»]+/g, '');
/** The choice the picked cause asks for, or null. */
export function causeDetailFor(d: CaseDetail | null | undefined, cause?: string | null): CaseDetail | null {
  if (!d?.options?.length || !cause) return null;
  const c = normCause(cause);
  return !d.causes?.length || d.causes.some((x) => normCause(x) === c) ? d : null;
}

export interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean; causes?: string[] }
