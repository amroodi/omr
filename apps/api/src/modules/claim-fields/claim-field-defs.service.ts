import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, ClaimPartyType, FieldGroup, FieldType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { DEFAULT_CLAIM_FIELDS } from './defaults';

interface DefInput {
  key: string;
  label: string;
  type?: FieldType;
  group?: FieldGroup;
  options?: string[];
  editableBy?: ClaimPartyType[];
  order?: number;
  required?: boolean;
}

@Injectable()
export class ClaimFieldDefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.scoped.claimFieldDef.findMany({ orderBy: { order: 'asc' } });
  }

  async create(input: DefInput) {
    const tenantId = getTenantIdOrThrow();
    if (await this.prisma.scoped.claimFieldDef.findFirst({ where: { key: input.key } })) {
      throw new BadRequestException('کلید فیلد تکراری است');
    }
    const def = await this.prisma.scoped.claimFieldDef.create({
      data: {
        tenantId,
        key: input.key.trim(),
        label: input.label.trim(),
        type: input.type ?? 'TEXT',
        group: input.group ?? 'CLAIM_DATA',
        options: input.options ?? [],
        editableBy: input.editableBy ?? ['MOAREF', 'INSURER_LEVEL'],
        order: input.order ?? 0,
        required: input.required ?? false,
      },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'ClaimFieldDef', targetId: def.id, metadata: { key: input.key } });
    return def;
  }

  async update(id: string, data: Partial<DefInput> & { isActive?: boolean }) {
    await this.prisma.scoped.claimFieldDef.updateMany({ where: { id }, data: data as any });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'ClaimFieldDef', targetId: id, metadata: data as Record<string, unknown> });
    return { ok: true };
  }

  async remove(id: string) {
    await this.prisma.scoped.claimFieldDef.deleteMany({ where: { id } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'ClaimFieldDef', targetId: id });
    return { ok: true };
  }

  /** Seed the default field catalog for this insurer (skips keys that already exist). */
  async seedDefaults() {
    const tenantId = getTenantIdOrThrow();
    const have = new Set((await this.prisma.scoped.claimFieldDef.findMany({ select: { key: true } })).map((d) => d.key));
    const toCreate = DEFAULT_CLAIM_FIELDS.filter((d) => !have.has(d.key)).map((d) => ({
      tenantId,
      key: d.key,
      label: d.label,
      type: d.type,
      group: d.group,
      options: d.options ?? [],
      editableBy: d.editableBy,
      order: d.order,
      required: d.required ?? false,
    }));
    if (toCreate.length) await this.prisma.scoped.claimFieldDef.createMany({ data: toCreate });
    return { created: toCreate.length };
  }
}
