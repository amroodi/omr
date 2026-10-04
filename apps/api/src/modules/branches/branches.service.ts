import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.scoped.branch.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, code: true } });
  }

  async create(name: string, code: string) {
    const tenantId = getTenantIdOrThrow();
    if (await this.prisma.scoped.branch.findFirst({ where: { code } })) {
      throw new BadRequestException('کد شعبه تکراری است');
    }
    const branch = await this.prisma.scoped.branch.create({ data: { tenantId, name: name.trim(), code: code.trim() } });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'Branch', targetId: branch.id, metadata: { code } });
    return branch;
  }

  async remove(id: string) {
    await this.prisma.scoped.branch.deleteMany({ where: { id } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'Branch', targetId: id });
    return { ok: true };
  }
}
