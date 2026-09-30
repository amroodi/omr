import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/**
 * Password hashing (argon2id) and OTP generation/verification.
 * OTP codes are stored only as salted SHA-256 hashes, never plaintext.
 */
@Injectable()
export class HashService {
  // No explicit argon2.Options annotation: it widens `raw` to boolean and breaks hash() overload
  // resolution. The literal keeps `raw` absent so the string-returning overload is selected.
  private readonly argonOpts = {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, this.argonOpts);
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Generate a numeric OTP of the given length (default 6). */
  generateOtp(length = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
    return code;
  }

  /** Salted hash for an OTP: returns "salt:hash". */
  hashOtp(code: string): string {
    const salt = randomBytes(16).toString('hex');
    const h = createHash('sha256').update(salt + code).digest('hex');
    return `${salt}:${h}`;
  }

  verifyOtp(stored: string, code: string): boolean {
    const [salt, expected] = stored.split(':');
    if (!salt || !expected) return false;
    const actual = createHash('sha256').update(salt + code).digest('hex');
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
