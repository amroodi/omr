/** What a filing form calls things, by the بیمه‌نامه's line and the نوع پرونده. */
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);

/** عمر covers death and disability; حوادث (and no policy chosen yet) covers injury and death. */
export const insuredNameLabel = (line?: string | null) =>
  (line === 'LIFE' ? 'نام بیمه‌شده (متوفی/از کار افتاده)' : 'نام بیمه‌شده (مصدوم/متوفی)');

export const EVENT_DATE_LABEL = 'تاریخ وقوع';

export function causeLabel(claimType: string) {
  if (DEATH_TYPES.has(claimType)) return 'علت فوت';
  return claimType === 'DISABILITY_ILLNESS' ? 'علت از کار افتادگی' : 'علت حادثه';
}

/** The ticked causes; the form shows ticks only once this list is filled. */
export const CAUSE_OPTIONS: string[] = [];
