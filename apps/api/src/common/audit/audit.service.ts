import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getContext } from '../tenant/tenant-context';
import { toJalali } from '../jalali/jalali.util';

export interface AuditInput {
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  tenantId?: string; // override (e.g. super-admin actions)
  actorType?: string;
  actorId?: string;
}

// Keys whose values must never land in the audit metadata in the clear.
const REDACT_KEYS = new Set([
  'nationalCode',
  'national_code',
  'phone',
  'password',
  'code',
  'otp',
  'iban',
  'token',
]);

/**
 * Append-only, hash-chained audit log. Each row's `hash` covers the previous row's `hash`, so
 * deleting or editing history breaks the chain and is detectable (see verifyChain()).
 * Writes use the un-scoped client because a few actions (login, provisioning) occur before a
 * tenant context exists; tenantId is set explicitly.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const ctx = getContext();
    if (ctx) ctx.audited = true;
    const tenantId = input.tenantId ?? ctx?.tenantId ?? null;
    const db = this.prisma.unscoped();

    try {
      // One writer per chain at a time (concurrent requests, several API processes): a transaction-
      // scoped advisory lock on the tenant's chain, so no two rows ever link to the same previous row.
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + (tenantId ?? 'platform')}))`;
        const prev = await tx.auditLog.findFirst({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          select: { hash: true, createdAt: true },
        });
        const prevHash = prev?.hash ?? null;
        // Strictly after the previous row, so ordering by createdAt always replays the chain.
        let now = new Date();
        if (prev && now.getTime() <= prev.createdAt.getTime()) now = new Date(prev.createdAt.getTime() + 1);
        await tx.auditLog.create({ data: this.build(input, ctx, tenantId, prevHash, now) });
      });
    } catch (err) {
      // Never let audit failure break the request, but make it loud.
      this.logger.error(`Audit write failed for ${input.action}: ${String(err)}`);
    }
  }

  private build(input: AuditInput, ctx: ReturnType<typeof getContext>, tenantId: string | null, prevHash: string | null, now: Date) {
    const row = {
      tenantId,
      actorType: input.actorType ?? ctx?.actorType ?? 'SYSTEM',
      actorId: input.actorId ?? ctx?.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      metadata: input.metadata ? JSON.stringify(this.redact(input.metadata)) : null,
      jalaliTimestamp: toJalali(now),
    };

    const hash = this.computeHash(prevHash, row, now);
    // Set createdAt explicitly so the stored timestamp matches the one folded into the hash
    // (a DB-defaulted now() would differ and break verifyChain()).
    return { ...row, prevHash, hash, createdAt: now };
  }

  private computeHash(prevHash: string | null, row: Record<string, unknown>, at: Date): string {
    const canonical = JSON.stringify({ prevHash, ...row, at: at.toISOString() });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = REDACT_KEYS.has(k) ? '[redacted]' : v;
    }
    return out;
  }

  /** Verify the per-tenant hash chain. Returns the id of the first broken row, or null if intact. */
  async verifyChain(tenantId: string | null): Promise<string | null> {
    const db = this.prisma.unscoped();
    const rows = await db.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    let prevHash: string | null = null;
    for (const r of rows) {
      if (r.prevHash !== prevHash) return r.id;
      const recomputed = this.computeHash(
        prevHash,
        {
          tenantId: r.tenantId,
          actorType: r.actorType,
          actorId: r.actorId,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          ip: r.ip,
          userAgent: r.userAgent,
          metadata: r.metadata,
          jalaliTimestamp: r.jalaliTimestamp,
        },
        r.createdAt,
      );
      if (recomputed !== r.hash) return r.id;
      prevHash = r.hash;
    }
    return null;
  }
}
