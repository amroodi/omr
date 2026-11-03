/** What a filing form calls things, by the بیمه‌نامه's line and the نوع پرونده. */

/** عمر covers death and disability; حوادث (and no policy chosen yet) covers injury and death. */
export const insuredNameLabel = (line?: string | null) =>
  (line === 'LIFE' ? 'نام بیمه‌شده (متوفی/از کار افتاده)' : 'نام بیمه‌شده (مصدوم/متوفی)');

/** نوع بیمه‌شده of a case. */
export const INSURED_RELATIONS: Record<string, string> = { MAIN: 'اصلی', SPOUSE: 'همسر', CHILD: 'فرزند', FATHER: 'پدر', MOTHER: 'مادر', OTHER: 'سایر' };

export const EVENT_DATE_LABEL = 'تاریخ وقوع';

export const CAUSE_LABEL = 'علت خسارت';

export interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean }
