import { isValidIban, isValidNationalCode, validateField } from './field-validation';

describe('field validation', () => {
  describe('Iranian National ID (کد ملی)', () => {
    it('accepts a correct checksum', () => {
      // first 9 digits 123456789 → check digit 1
      expect(isValidNationalCode('1234567891')).toBe(true);
    });
    it('rejects a wrong checksum', () => {
      expect(isValidNationalCode('1234567890')).toBe(false);
    });
    it('rejects all-identical digits', () => {
      expect(isValidNationalCode('1111111111')).toBe(false);
    });
    it('rejects wrong length / non-digits', () => {
      expect(isValidNationalCode('12345')).toBe(false);
      expect(isValidNationalCode('12345abcde')).toBe(false);
    });
  });

  describe('Iranian IBAN (شبا)', () => {
    it('accepts a valid IBAN', () => {
      expect(isValidIban('IR062960000000100324200001')).toBe(true);
    });
    it('rejects a tampered IBAN', () => {
      expect(isValidIban('IR062960000000100324200002')).toBe(false);
    });
    it('rejects wrong format', () => {
      expect(isValidIban('IR123')).toBe(false);
    });
  });

  describe('validateField dispatcher', () => {
    it('normalizes Persian digits for national code', () => {
      expect(validateField('NATIONAL_CODE', '۱۲۳۴۵۶۷۸۹۱').valid).toBe(true);
    });
    it('enforces amount ceiling', () => {
      expect(validateField('AMOUNT', '600', { maxAmount: 500 }).valid).toBe(false);
      expect(validateField('AMOUNT', '400', { maxAmount: 500 }).valid).toBe(true);
    });
    it('rejects future dates', () => {
      const future = new Date(Date.now() + 10 * 864e5).toISOString();
      expect(validateField('DATE', future).valid).toBe(false);
    });
    it('validates SELECT options', () => {
      expect(validateField('SELECT', 'فرزند', { options: ['همسر', 'فرزند'] }).valid).toBe(true);
      expect(validateField('SELECT', 'x', { options: ['همسر', 'فرزند'] }).valid).toBe(false);
    });
    it('allows empty (required is separate)', () => {
      expect(validateField('NATIONAL_CODE', '').valid).toBe(true);
    });
  });
});
