import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { FieldCryptoService } from '../crypto/field-crypto.service';

/**
 * Private file storage with encryption at rest (AES-256-GCM via FieldCryptoService).
 *
 * The `local` driver writes to STORAGE_DIR, a private directory NOT served statically — files are
 * only reachable through the authorized, audit-logged download endpoint. Swap in an S3/object
 * storage driver behind this same interface for production; call sites do not change.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly baseDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: FieldCryptoService,
  ) {
    this.baseDir = resolve(this.config.get<string>('STORAGE_DIR', '.storage'));
  }

  /** Encrypt and persist a file. Returns an opaque storage key. */
  async save(tenantId: string, buffer: Buffer): Promise<string> {
    const key = `${tenantId}/${randomUUID()}.enc`;
    const full = join(this.baseDir, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, this.crypto.encryptBuffer(buffer));
    return key;
  }

  /** Read and decrypt a stored file. */
  async read(storageKey: string): Promise<Buffer> {
    const full = this.safePath(storageKey);
    const enc = await readFile(full);
    return this.crypto.decryptBuffer(enc);
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.safePath(storageKey));
    } catch (e) {
      this.logger.warn(`Failed to delete ${storageKey}: ${String(e)}`);
    }
  }

  /** Prevent path traversal: the resolved path must stay under baseDir. */
  private safePath(storageKey: string): string {
    const full = resolve(join(this.baseDir, storageKey));
    if (!full.startsWith(this.baseDir)) throw new Error('Invalid storage key');
    return full;
  }
}
