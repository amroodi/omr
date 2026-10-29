import { base32Decode, base32Encode, generateTotpSecret, totpAt, verifyTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B test secret ("12345678901234567890", SHA1).
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors (last 6 digits)', () => {
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(secret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('base32 round-trips', () => {
    const b = Buffer.from('hello world 123');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it('accepts the current and adjacent step, rejects others and junk', () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(s, totpAt(s, step), 1, now)).toBe(step);
    expect(verifyTotp(s, totpAt(s, step - 1), 1, now)).toBe(step - 1);
    expect(verifyTotp(s, totpAt(s, step + 3), 1, now)).toBeNull();
    expect(verifyTotp(s, 'abc123', 1, now)).toBeNull();
    expect(verifyTotp(s, '', 1, now)).toBeNull();
  });
});
