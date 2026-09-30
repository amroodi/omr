import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * Pure AES-256-GCM + blind-index primitives, framework-free, so both the Nest service and the
 * standalone Prisma seed share one implementation. Ciphertext format:
 *   v<keyVersion>:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

export function normalizeValue(value: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return String(value)
    .trim()
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
}

export function encryptValue(key: Buffer, version: string, plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptValue(keys: Map<string, Buffer>, ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || !parts[0].startsWith('v')) {
    throw new Error('Malformed ciphertext (expected v<ver>:<iv>:<tag>:<data>).');
  }
  const version = parts[0].slice(1);
  const key = keys.get(version);
  if (!key) throw new Error(`No decryption key loaded for version ${version}.`);
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function blindIndexValue(pepper: Buffer, value: string): string {
  return createHmac('sha256', pepper).update(normalizeValue(value)).digest('hex');
}
