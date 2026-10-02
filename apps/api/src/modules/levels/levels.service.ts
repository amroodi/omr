import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalLevelKind } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { AuditAction } from '@prisma/client';

interface LevelInput {
  name: string;
  order: number;
  ceiling?: string | null; // null/omitted = unlimited
  kind?: ApprovalLevelKind;
}

@Injectable()
export class LevelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.scoped.approvalLevel.findMany({ orderBy: { order: 'asc' } });
  }

  async create(input: LevelInput) {
    const tenantId = getTenantIdOrThrow();
    const exists = await this.prisma.scoped.approvalLevel.findFirst({ where: { order: input.order } });
    if (exists) throw new BadRequestException('ترتیب (order) تکراری است');
    const level = await this.prisma.scoped.approvalLevel.create({
      data: {
        tenantId,
        name: input.name.trim(),
        order: input.order,
        ceiling: input.ceiling ?? null,
        kind: input.kind ?? 'CUSTOM',
      },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'ApprovalLevel', targetId: level.id, metadata: { order: input.order } });
    return level;
  }

  async remove(id: string) {
    await this.prisma.scoped.approvalLevel.deleteMany({ where: { id } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'ApprovalLevel', targetId: id });
    return { ok: true };
  }
}
