import { randomBytes } from 'crypto';
import {
  blindIndexValue,
  decryptValue,
  encryptValue,
  normalizeValue,
} from './field-crypto.core';

describe('field-crypto core', () => {
  const version = '1';
  const key = randomBytes(32);
  const keys = new Map([[version, key]]);
  const pepper = randomBytes(32);

  it('round-trips a value', () => {
    const ct = encryptValue(key, version, 'کد ملی ۳۱۴۹');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(decryptValue(keys, ct)).toBe('کد ملی ۳۱۴۹');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptValue(key, version, 'x')).not.toBe(encryptValue(key, version, 'x'));
  });

  it('detects tampering via the GCM auth tag', () => {
    const ct = encryptValue(key, version, 'sensitive');
    const parts = ct.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 0xff; // flip a bit
    parts[3] = data.toString('base64');
    expect(() => decryptValue(keys, parts.join(':'))).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const ct = encryptValue(key, version, 'secret');
    const otherKeys = new Map([[version, randomBytes(32)]]);
    expect(() => decryptValue(otherKeys, ct)).toThrow();
  });

  it('blind index is deterministic and normalizes Persian digits', () => {
    const a = blindIndexValue(pepper, '۳۱۴۹۵۱۴۸۷۸');
    const b = blindIndexValue(pepper, '3149514878');
    expect(a).toBe(b); // Persian and ASCII digits map to the same index
  });

  it('blind index changes with the value', () => {
    expect(blindIndexValue(pepper, '1')).not.toBe(blindIndexValue(pepper, '2'));
  });

  it('normalizeValue converts Persian/Arabic digits to ASCII and trims', () => {
    expect(normalizeValue('  ۰۹۱۲ ')).toBe('0912');
    expect(normalizeValue('٠٩١٢')).toBe('0912');
  });
});
