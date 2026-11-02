/** What a filing form calls things, by the بیمه‌نامه's line and the نوع پرونده. */
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);

/** عمر covers death and disability; حوادث (and no policy chosen yet) covers injury and death. */
export const insuredNameLabel = (line?: string | null) =>
  (line === 'LIFE' ? 'نام بیمه‌شده (متوفی/از کار افتاده)' : 'نام بیمه‌شده (مصدوم/متوفی)');

export const EVENT_DATE_LABEL = 'تاریخ وقوع';

export const CAUSE_LABEL = 'علت خسارت';

/** Which cause list a نوع پرونده shows: death and illness disability → فوت; accident injury → حادثه. */
export const causeGroup = (claimType: string): 'DEATH' | 'ACCIDENT' =>
  (DEATH_TYPES.has(claimType) || claimType === 'DISABILITY_ILLNESS' ? 'DEATH' : 'ACCIDENT');
