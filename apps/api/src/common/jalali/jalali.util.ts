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

/** Format a JS Date as a Jalali (Shamsi) string, e.g. "۱۴۰۴/۰۷/۰۸ ۱۴:۳۰". */
export function toJalali(date: Date, withTime = true): string {
  const { jy, jm, jd } = jalaali.toJalaali(date);
  const p = (n: number) => String(n).padStart(2, '0');
  let out = `${jy}/${p(jm)}/${p(jd)}`;
  if (withTime) out += ` ${p(date.getHours())}:${p(date.getMinutes())}`;
  return toPersianDigits(out);
}

/** Parse a Jalali date string "YYYY/MM/DD" (Persian or ASCII digits) to a JS Date. */
export function fromJalali(jalaliStr: string): Date {
  const [jy, jm, jd] = toAsciiDigits(jalaliStr).split('/').map(Number);
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  return new Date(gy, gm - 1, gd);
}
