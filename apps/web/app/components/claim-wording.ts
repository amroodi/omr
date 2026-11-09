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

export interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean; causes?: string[] }
