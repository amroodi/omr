import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { blindIndexValue, decryptValue, encryptValue } from './field-crypto.core';

/**
 * AES-256-GCM field-level encryption + HMAC blind index.
 *
 * Ciphertext format (versioned for key rotation):
 *   v<keyVersion>:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * - Each encryption uses a fresh random 96-bit IV (GCM standard).
 * - The GCM auth tag is stored with the value, so tampering is detected on decrypt.
 * - `keyVersion` is embedded, so old values keep decrypting after a key rotation.
 *
 * Production note: `FIELD_ENCRYPTION_KEY` here is a locally-held data key. For production,
 * wrap it with a KMS (envelope encryption): fetch/decrypt the data key from AWS KMS / Vault
 * at boot and pass it in place of the env value. Call sites do not change.
 */
@Injectable()
export class FieldCryptoService implements OnModuleInit {
  private readonly logger = new Logger(FieldCryptoService.name);
  private currentVersion!: string;
  private keys = new Map<string, Buffer>(); // version -> 32-byte key
  private pepper!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.currentVersion = this.config.get<string>('FIELD_ENCRYPTION_KEY_VERSION', '1');
    const b64 = this.config.get<string>('FIELD_ENCRYPTION_KEY', '');
    const key = this.decodeKey(b64, 'FIELD_ENCRYPTION_KEY', 32, true);
    this.keys.set(this.currentVersion, key);

    // Additional retired keys for decrypt-only, provided as
    // FIELD_ENCRYPTION_KEY_V<n>. Add them so rotation is zero-downtime.
    for (let v = 1; v <= 20; v++) {
      const label = String(v);
      if (label === this.currentVersion) continue;
      const legacy = this.config.get<string>(`FIELD_ENCRYPTION_KEY_V${label}`);
      if (legacy) {
        this.keys.set(label, this.decodeKey(legacy, `FIELD_ENCRYPTION_KEY_V${label}`, 32, true));
      }
    }

    const pepperB64 = this.config.get<string>('BLIND_INDEX_PEPPER', '');
    this.pepper = this.decodeKey(pepperB64, 'BLIND_INDEX_PEPPER', 16, false);
    this.logger.log(
      `Field crypto ready (current key v${this.currentVersion}, ${this.keys.size} key(s) loaded)`,
    );
  }

  /**
   * Decode a base64 secret. `exact` = true returns exactly `minBytes` bytes (for the AES key,
   * which must be 32 bytes); false keeps the full buffer (for the HMAC pepper).
   */
  private decodeKey(b64: string, name: string, minBytes = 32, exact = false): Buffer {
    if (!b64 || b64.startsWith('REPLACE_ME')) {
      throw new Error(`${name} is not set. Generate one and put it in .env — see .env.example.`);
    }
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < minBytes) {
      throw new Error(`${name} must be at least ${minBytes} bytes (base64-encoded).`);
    }
    return exact ? buf.subarray(0, minBytes) : buf;
  }

  /** Encrypt a plaintext string. Returns versioned ciphertext, or null for null/undefined. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    return encryptValue(this.keys.get(this.currentVersion)!, this.currentVersion, String(plaintext));
  }

  /** Decrypt a versioned ciphertext produced by encrypt(). */
  decrypt(ciphertext: string | null | undefined): string | null {
    if (ciphertext === null || ciphertext === undefined) return null;
    return decryptValue(this.keys, String(ciphertext));
  }

  /**
   * Deterministic blind index for searchable encrypted fields.
   * HMAC-SHA256 over a normalized value with a server-only pepper. Storing this lets us
   * look up a record by (say) National ID without ever querying the plaintext.
   */
  blindIndex(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return blindIndexValue(this.pepper, String(value));
  }

  /** Constant-time comparison of two blind indexes / hashes. */
  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
