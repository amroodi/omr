import { FieldType } from '@prisma/client';

export interface FieldValidity {
  valid: boolean;
  message?: string;
}

/** Iranian National ID (کد ملی) checksum. 10 digits, rejects all-identical. */
export function isValidNationalCode(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const d = code.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * (10 - i);
  const r = sum % 11;
  return (r < 2 && d[9] === r) || (r >= 2 && d[9] === 11 - r);
}

/** Iranian IBAN (شبا): "IR" + 24 digits, ISO 13616 mod-97 checksum. */
export function isValidIban(input: string): boolean {
  const s = input.replace(/\s/g, '').toUpperCase().replace(/^IR/, 'IR');
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const converted = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of converted) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toAscii = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * Deterministic validation of a field value by its type. Independent of OCR — catches a large
 * share of extraction errors (checksums, ranges, formats) regardless of model confidence.
 */
export function validateField(
  type: FieldType,
  rawValue: string,
  opts: { options?: string[]; maxAmount?: number } = {},
): FieldValidity {
  const value = (rawValue ?? '').trim();
  if (value === '') return { valid: true }; // empty is allowed; `required` is enforced separately

  switch (type) {
    case 'NATIONAL_CODE':
      return isValidNationalCode(toAscii(value))
        ? { valid: true }
        : { valid: false, message: 'کد ملی نامعتبر است (کنترل رقم کنترلی ناموفق).' };
    case 'IBAN':
      return isValidIban(toAscii(value))
        ? { valid: true }
        : { valid: false, message: 'شماره شبا نامعتبر است.' };
    case 'AMOUNT':
    case 'NUMBER': {
      const n = Number(toAscii(value).replace(/,/g, ''));
      if (Number.isNaN(n) || n < 0) return { valid: false, message: 'مقدار عددی نامعتبر است.' };
      if (type === 'AMOUNT' && opts.maxAmount !== undefined && n > opts.maxAmount) {
        return { valid: false, message: `مبلغ نباید از سرمایه بیشتر باشد (${opts.maxAmount.toLocaleString('fa-IR')}).` };
      }
      return { valid: true };
    }
    case 'DATE': {
      const d = new Date(value);
      if (isNaN(d.getTime())) return { valid: false, message: 'تاریخ نامعتبر است.' };
      if (d.getTime() > Date.now() + 864e5) return { valid: false, message: 'تاریخ نمی‌تواند در آینده باشد.' };
      return { valid: true };
    }
    case 'SELECT':
      return !opts.options || opts.options.includes(value)
        ? { valid: true }
        : { valid: false, message: 'گزینه نامعتبر است.' };
    case 'BOOL':
      return ['true', 'false', '0', '1'].includes(value.toLowerCase())
        ? { valid: true }
        : { valid: false, message: 'مقدار باید بله/خیر باشد.' };
    default:
      return { valid: true };
  }
}
