import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, ClaimType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { DEFAULT_REQUIRED_DOCS } from './defaults';

interface DocInput {
  code: string;
  label: string;
  appliesToTypes?: ClaimType[];
  order?: number;
}

@Injectable()
export class RequiredDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.scoped.requiredDocument.findMany({ orderBy: { order: 'asc' } });
  }

  async create(input: DocInput) {
    const tenantId = getTenantIdOrThrow();
    const exists = await this.prisma.scoped.requiredDocument.findFirst({ where: { code: input.code } });
    if (exists) throw new BadRequestException('کد مدرک تکراری است');
    const doc = await this.prisma.scoped.requiredDocument.create({
      data: { tenantId, code: input.code.trim(), label: input.label.trim(), appliesToTypes: input.appliesToTypes ?? [], order: input.order ?? 0 },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'RequiredDocument', targetId: doc.id, metadata: { code: input.code } });
    return doc;
  }

  async update(id: string, data: { label?: string; appliesToTypes?: ClaimType[]; order?: number; isActive?: boolean }) {
    await this.prisma.scoped.requiredDocument.updateMany({ where: { id }, data });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'RequiredDocument', targetId: id, metadata: data as Record<string, unknown> });
    return { ok: true };
  }

  async remove(id: string) {
    await this.prisma.scoped.requiredDocument.deleteMany({ where: { id } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'RequiredDocument', targetId: id });
    return { ok: true };
  }

  /** Seed the default catalog for this insurer (skips codes that already exist). */
  async seedDefaults() {
    const tenantId = getTenantIdOrThrow();
    const existing = new Set((await this.prisma.scoped.requiredDocument.findMany({ select: { code: true } })).map((d) => d.code));
    const toCreate = DEFAULT_REQUIRED_DOCS.filter((d) => !existing.has(d.code)).map((d) => ({ ...d, tenantId }));
    if (toCreate.length) await this.prisma.scoped.requiredDocument.createMany({ data: toCreate });
    return { created: toCreate.length };
  }
}
