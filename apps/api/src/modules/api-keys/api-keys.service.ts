import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

/** Scopes a key can grant. Keep in sync with the partner endpoints that check them. */
export const API_SCOPES = {
  CLAIM_STATUS: 'claim:status', // read-only, non-PII claim status lookup
} as const;
export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];
const ALL_SCOPES = new Set<string>(Object.values(API_SCOPES));

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Create a key. Returns the plaintext secret ONCE — it is never retrievable again. */
  async create(input: CreateApiKeyInput) {
    const tenantId = getTenantIdOrThrow();
    const scopes = [...new Set(input.scopes ?? [])];
    if (scopes.length === 0) throw new BadRequestException('حداقل یک دسترسی (scope) را انتخاب کنید');
    for (const s of scopes) if (!ALL_SCOPES.has(s)) throw new BadRequestException(`scope نامعتبر: ${s}`);

    const prefix = `omr_live_${randomBytes(5).toString('hex')}`; // 10 hex chars, public lookup id
    const secret = randomBytes(24).toString('base64url'); // 32-char secret part
    const fullKey = `${prefix}.${secret}`;

    const row = await this.prisma.scoped.apiKey.create({
      data: {
        tenantId,
        name: input.name.trim(),
        prefix,
        keyHash: this.hashKey(fullKey),
        scopes,
        createdById: getContext()?.actorId ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'ApiKey', targetId: row.id, metadata: { name: row.name, scopes } });
    // The only time the plaintext leaves the server.
    return { id: row.id, name: row.name, prefix, scopes, key: fullKey, createdAt: row.createdAt };
  }

  async list() {
    const rows = await this.prisma.scoped.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    }));
  }

  async revoke(id: string) {
    const existing = await this.prisma.scoped.apiKey.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('کلید یافت نشد');
    await this.prisma.scoped.apiKey.updateMany({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'ApiKey', targetId: id, metadata: { name: existing.name } });
    return { ok: true };
  }

  /**
   * Validate a raw key for the guard. Runs BEFORE any tenant context exists, so it uses the
   * un-scoped client and resolves the tenant from the key itself. Returns null on any failure.
   */
  async verify(rawKey: string): Promise<{ tenantId: string; scopes: string[]; id: string } | null> {
    const prefix = rawKey.split('.')[0];
    if (!prefix) return null;
    const row = await this.prisma.unscoped().apiKey.findUnique({ where: { prefix } });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    if (this.hashKey(rawKey) !== row.keyHash) return null;
    // Best-effort last-used stamp; never block the request on it.
    this.prisma.unscoped().apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    return { tenantId: row.tenantId, scopes: row.scopes, id: row.id };
  }

  private hashKey(fullKey: string): string {
    return createHash('sha256').update(fullKey).digest('hex');
  }
}
