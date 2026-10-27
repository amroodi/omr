import * as jalaali from 'jalaali-js';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Convert ASCII digits in a string to Persian digits. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Convert Persian/Arabic digits to ASCII. */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * The calendar date and clock time of `date` in Tehran — the server may run in any time zone (UTC on
 * the production box), but every date and time the system shows is Iran's local time.
 */
const TEHRAN = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function tehranParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const v: Record<string, number> = {};
  for (const p of TEHRAN.formatToParts(date)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return { y: v.year, m: v.month, d: v.day, hh: v.hour % 24, mm: v.minute, ss: v.second };
}

/** Format a JS Date as a Jalali (Shamsi) string in Tehran time, e.g. "۱۴۰۴/۰۷/۰۸ ۱۴:۳۰". */
export function toJalali(date: Date, withTime = true, withSeconds = false): string {
  const t = tehranParts(date);
  const { jy, jm, jd } = jalaali.toJalaali(t.y, t.m, t.d);
  const p = (n: number) => String(n).padStart(2, '0');
  let out = `${jy}/${p(jm)}/${p(jd)}`;
  if (withTime) out += ` ${p(t.hh)}:${p(t.mm)}${withSeconds ? `:${p(t.ss)}` : ''}`;
  return toPersianDigits(out);
}

/** The Jalali year in Tehran right now (or at `date`). */
export function jalaliYear(date: Date = new Date()): number {
  const t = tehranParts(date);
  return jalaali.toJalaali(t.y, t.m, t.d).jy;
}

/** Parse a Jalali date string "YYYY/MM/DD" (Persian or ASCII digits) to a JS Date. */
export function fromJalali(jalaliStr: string): Date {
  const [jy, jm, jd] = toAsciiDigits(jalaliStr).split('/').map(Number);
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  // Midnight in Tehran (UTC+03:30, no DST since 2022), whatever the server's own time zone is.
  return new Date(Date.UTC(gy, gm - 1, gd) - 210 * 60 * 1000);
}
