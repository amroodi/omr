import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';

export interface AuditQuery {
  action?: AuditAction;
  actorType?: string;
  targetType?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  page?: number;
  pageSize?: number;
}

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Org-scoped audit trail (tenant from the caller's token). */
  list(query: AuditQuery) {
    const tenantId = getTenantIdOrThrow();
    return this.query({ ...this.where(query), tenantId }, query);
  }

  /** Platform-wide audit trail for super-admins; optional tenant filter. */
  globalList(query: AuditQuery & { tenantId?: string }) {
    const where = this.where(query);
    if (query.tenantId) where.tenantId = query.tenantId;
    return this.query(where, query);
  }

  /** Verify the per-tenant hash chain is intact (tamper evidence). */
  async integrity(): Promise<{ intact: boolean; brokenAtId: string | null }> {
    const tenantId = getTenantIdOrThrow();
    const brokenAtId = await this.audit.verifyChain(tenantId);
    return { intact: brokenAtId === null, brokenAtId };
  }

  private where(query: AuditQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actorType) where.actorType = query.actorType;
    if (query.targetType) where.targetType = query.targetType;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    }
    return where;
  }

  private async query(where: Prisma.AuditLogWhereInput, query: AuditQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    // Audit reads use the un-scoped client with an explicit tenant filter: AuditLog rows can have
    // a null tenantId (pre-tenant events like failed logins), which the scoped extension rejects.
    const db = this.prisma.unscoped();

    const [total, rows] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          actorType: true,
          actorId: true,
          action: true,
          targetType: true,
          targetId: true,
          ip: true,
          userAgent: true,
          metadata: true,
          jalaliTimestamp: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        ...r,
        metadata: r.metadata ? safeParse(r.metadata) : null,
      })),
    };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
