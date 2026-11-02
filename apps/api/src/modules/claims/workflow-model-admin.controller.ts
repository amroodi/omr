import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, ValidateNested } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { DEFAULT_WORKFLOW_MODEL, modelFrom } from './workflow';

class PanelRightsDto {
  @IsBoolean() upload!: boolean;
  @IsBoolean() submit!: boolean;
}
class PanelsDto {
  @ValidateNested() @Type(() => PanelRightsDto) COMPANY!: PanelRightsDto;
  @ValidateNested() @Type(() => PanelRightsDto) REPRESENTATIVE!: PanelRightsDto;
}
class WorkflowModelDto {
  @IsBoolean() councilEnabled!: boolean;
  @IsBoolean() requireLossNotice!: boolean;
  @IsBoolean() requireOriginals!: boolean;
  @ValidateNested() @Type(() => PanelsDto) panels!: PanelsDto;
}

/** Model View: Super Admin alone decides how each insurer's chain works. */
@SuperAdminOnly()
@Controller('admin/workflow-model')
export class WorkflowModelAdminController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  async list() {
    const db = this.prisma.unscoped();
    const insurers = await db.tenant.findMany({ where: { kind: 'INSURER' }, orderBy: { name: 'asc' }, select: { id: true, name: true, workflowModel: true } });
    const atCouncil = await db.claim.groupBy({ by: ['insurerTenantId'], where: { currentStage: 'COUNCIL', deletedAt: null }, _count: true });
    const open = new Map(atCouncil.map((r) => [r.insurerTenantId, r._count]));
    return {
      defaults: DEFAULT_WORKFLOW_MODEL,
      insurers: insurers.map((t) => ({ id: t.id, name: t.name, customized: t.workflowModel != null, casesAtCouncil: open.get(t.id) ?? 0, model: modelFrom(t.workflowModel) })),
    };
  }

  @Put(':insurerId')
  async save(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: WorkflowModelDto) {
    const db = this.prisma.unscoped();
    const t = await db.tenant.findUnique({ where: { id: insurerId }, select: { kind: true, workflowModel: true } });
    if (!t || t.kind !== 'INSURER') throw new NotFoundException('بیمه‌گر یافت نشد');
    const model = modelFrom(dto);
    // Someone must be able to send a case on, or every new case would stop at the بیمه‌گزار desk.
    if (!model.panels.COMPANY.submit && !model.panels.REPRESENTATIVE.submit) throw new BadRequestException('دست‌کم یکی از پنل‌ها باید بتواند پرونده را ارسال کند');
    if (!model.panels.COMPANY.upload && !model.panels.REPRESENTATIVE.upload) throw new BadRequestException('دست‌کم یکی از پنل‌ها باید بتواند مدارک را بارگذاری کند');
    await db.tenant.update({ where: { id: insurerId }, data: { workflowModel: model as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: insurerId, targetType: 'WorkflowModel', targetId: insurerId, metadata: { before: modelFrom(t.workflowModel), after: model } as any });
    return model;
  }
}
