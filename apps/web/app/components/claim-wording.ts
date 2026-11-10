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
