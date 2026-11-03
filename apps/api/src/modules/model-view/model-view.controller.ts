import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, Matches, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { NOTICE_TARGETS, rulesFor, SOURCE_FA, SOURCES_OF, TARGET_FA, TARGETS_OF } from '../claims/claim-notice';
import { DEFAULT_WORKFLOW_MODEL, modelFrom } from '../claims/workflow';
import { CoverageService, coverageFrom } from './coverage.service';
import { ModelStore } from './model-store.service';
import { allKinds } from '../../common/kinds';

class DocRowDto {
  @IsString() @Length(1, 80) code!: string;
  @IsString() @Length(2, 500) label!: string;
  @IsBoolean() isActive!: boolean;
  @IsArray() @IsString({ each: true }) appliesToTypes!: string[];
  @IsArray() @IsString({ each: true }) requiredTypes!: string[];
  // نوع بیمه‌نامه it belongs to (empty = every kind)
  @IsOptional() @IsArray() @IsString({ each: true }) kinds?: string[];
}
class DocsDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DocRowDto) docs!: DocRowDto[];
}
class CoverageDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Length(0, 500) url!: string;
  @IsString() @Length(1, 60) @Matches(/^[\w-]+$/) nationalCodeParam!: string;
  @IsString() @Length(1, 60) @Matches(/^[\w-]+$/) authHeader!: string;
  @IsOptional() @IsString() @Length(0, 2000) secret?: string; // empty/absent keeps the stored one
  @IsInt() @Min(1) @Max(600) perMinute!: number;
}
class CoverageTestDto {
  @IsString() @Matches(/^\d{10}$/) nationalCode!: string;
}

/** Model View: Super Admin alone decides how each insurer's chain works. Every save is audited. */
@SuperAdminOnly()
@Controller('admin/workflow-model')
export class ModelViewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly store: ModelStore,
    private readonly coverage: CoverageService,
    private readonly crypto: FieldCryptoService,
  ) {}

  @Get()
  async list() {
    const db = this.prisma.unscoped();
    const orgs = await db.tenant.findMany({ where: { kind: { in: ['INSURER', 'BROKER'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, kind: true, workflowModel: true, coverageConfig: true, claimNoticeRules: true } });
    const insurers = orgs.filter((o) => o.kind === 'INSURER');
    const [atCouncil, notChecked, docs] = await Promise.all([
      db.claim.groupBy({ by: ['insurerTenantId'], where: { currentStage: 'COUNCIL', deletedAt: null }, _count: true }),
      db.claim.groupBy({ by: ['insurerTenantId'], where: { coverageStatus: 'NOT_CHECKED', deletedAt: null }, _count: true }),
      db.requiredDocument.findMany({ where: { tenantId: { in: insurers.map((i) => i.id) } }, orderBy: { order: 'asc' }, select: { tenantId: true, code: true, label: true, isActive: true, appliesToTypes: true, requiredTypes: true, kinds: true } }),
    ]);
    // Companies an insurer's Model View can group: those holding a contract with it, wherever the brokerage.
    const contracts = await db.policyholderContract.findMany({ where: { insurerTenantId: { in: insurers.map((i) => i.id) } }, select: { insurerTenantId: true, company: { select: { id: true, name: true, parentId: true } } } });
    const count = (rows: { insurerTenantId: string; _count: number }[], id: string) => rows.find((r) => r.insurerTenantId === id)?._count ?? 0;
    return {
      defaults: DEFAULT_WORKFLOW_MODEL,
      kinds: allKinds(), // نوع بیمه‌نامه catalog (Super Admin › انواع بیمه‌نامه)
      insurers: insurers.map((t) => {
        const c = coverageFrom(t.coverageConfig);
        return {
          id: t.id, name: t.name, customized: t.workflowModel != null, casesAtCouncil: count(atCouncil, t.id), model: modelFrom(t.workflowModel),
          docs: docs.filter((d) => d.tenantId === t.id).map(({ tenantId: _, ...d }) => d),
          companies: [...new Map(contracts.filter((k) => k.insurerTenantId === t.id).map((k) => [k.company.id, k.company])).values()].sort((a, b) => a.name.localeCompare(b.name, 'fa')),
          coverage: { enabled: c.enabled, url: c.url, nationalCodeParam: c.nationalCodeParam, authHeader: c.authHeader, hasSecret: !!c.secret, perMinute: c.perMinute, notChecked: count(notChecked, t.id) },
        };
      }),
      notice: orgs.map((o) => ({
        id: o.id, name: o.name, kind: o.kind,
        sources: SOURCES_OF[o.kind].map((key) => ({ key, label: SOURCE_FA[key], allowed: TARGETS_OF[key], rule: rulesFor(o.kind, o.claimNoticeRules)[key] })),
      })),
      targets: NOTICE_TARGETS.map((key) => ({ key, label: TARGET_FA[key] })),
    };
  }

  private async insurer(id: string) {
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id }, select: { kind: true, workflowModel: true, coverageConfig: true } });
    if (!t || t.kind !== 'INSURER') throw new NotFoundException('بیمه‌گر یافت نشد');
    return t;
  }

  @Put(':insurerId')
  async save(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() body: Record<string, unknown>) {
    const t = await this.insurer(insurerId);
    const model = modelFrom(body); // keeps only valid values
    // Someone must be able to move a case, or every new case would stop at the بیمه‌گزار desk.
    if (!model.panels.COMPANY.submit && !model.panels.REPRESENTATIVE.submit) throw new BadRequestException('دست‌کم یکی از پنل‌ها باید بتواند پرونده را ارسال کند');
    if (!model.panels.COMPANY.upload && !model.panels.REPRESENTATIVE.upload) throw new BadRequestException('دست‌کم یکی از پنل‌ها باید بتواند مدارک را بارگذاری کند');
    const dropped = modelFrom(t.workflowModel).form.caseTypes.filter((x) => !model.form.caseTypes.some((y) => y.code === x.code)).map((x) => x.code);
    if (dropped.length && await this.prisma.unscoped().claim.count({ where: { insurerTenantId: insurerId, claimType: { in: dropped } } })) throw new BadRequestException('نوع پرونده‌ای که پرونده دارد حذف نمی‌شود؛ آن را از فهرست‌های بیمه‌نامه بردارید');
    if (model.insured.enabled && !model.insured.docCodes.length) throw new BadRequestException('مدارکی را که بیمه‌شده بارگذاری می‌کند انتخاب کنید');
    await this.prisma.unscoped().tenant.update({ where: { id: insurerId }, data: { workflowModel: model as unknown as Prisma.InputJsonValue } });
    await this.store.load(insurerId);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: insurerId, targetType: 'WorkflowModel', targetId: insurerId, metadata: { before: modelFrom(t.workflowModel), after: model } as any });
    return model;
  }

  /**
   * The insurer's documents: wording, order, which نوع بیمه‌نامه each belongs to, and for each نوع پرونده
   * whether listed and whether required. A document left out of the list is deleted — or, when a case
   * already holds a file for it, switched off so those files keep their name.
   */
  @Put(':insurerId/docs')
  async saveDocs(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: DocsDto) {
    await this.insurer(insurerId);
    const db = this.prisma.unscoped();
    const known = new Set(allKinds().map((k) => k.code));
    const rows = dto.docs.map((d, i) => ({ code: d.code, label: d.label.trim(), isActive: d.isActive, appliesToTypes: d.appliesToTypes, requiredTypes: d.requiredTypes.filter((x) => d.appliesToTypes.includes(x)), kinds: [...new Set((d.kinds ?? []).filter((k) => known.has(k)))], order: i + 1 }));
    const gone = (await db.requiredDocument.findMany({ where: { tenantId: insurerId, code: { notIn: rows.map((r) => r.code) } }, select: { code: true } })).map((r) => r.code);
    const used = gone.length ? new Set((await db.document.findMany({ where: { docCode: { in: gone }, claimId: { in: (await db.claim.findMany({ where: { insurerTenantId: insurerId }, select: { id: true } })).map((c) => c.id) } }, distinct: ['docCode'], select: { docCode: true } })).map((r) => r.docCode)) : new Set<string | null>();
    await db.$transaction([
      ...rows.map((d) => db.requiredDocument.upsert({ where: { tenantId_code: { tenantId: insurerId, code: d.code } }, update: d, create: { ...d, tenantId: insurerId } })),
      db.requiredDocument.deleteMany({ where: { tenantId: insurerId, code: { in: gone.filter((c) => !used.has(c)) } } }),
      db.requiredDocument.updateMany({ where: { tenantId: insurerId, code: { in: gone.filter((c) => used.has(c)) } }, data: { isActive: false } }),
    ]);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: insurerId, targetType: 'RequiredDocument', targetId: insurerId, metadata: { docs: dto.docs } as any });
    return { ok: true };
  }

  /** «اعلام خسارت» rules of an insurer or a کارگزاری. */
  @Put(':orgId/notice')
  async saveNotice(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: Record<string, unknown>) {
    const db = this.prisma.unscoped();
    const t = await db.tenant.findUnique({ where: { id: orgId }, select: { kind: true } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    const rules = rulesFor(t.kind, body);
    await db.tenant.update({ where: { id: orgId }, data: { claimNoticeRules: rules as Prisma.InputJsonValue } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: orgId, targetType: 'ClaimNoticeRules', targetId: orgId, metadata: rules as any });
    return rules;
  }

  /** The فن‌آوران connection of one insurer. The secret is write-only. */
  @Put(':insurerId/coverage')
  async saveCoverage(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: CoverageDto) {
    const t = await this.insurer(insurerId);
    const cur = coverageFrom(t.coverageConfig);
    if (dto.enabled && !dto.url.trim()) throw new BadRequestException('پیش از فعال‌سازی، نشانی سرویس را وارد کنید');
    if (dto.url.trim()) this.coverage.assertUrl(dto.url.trim());
    const next = { enabled: dto.enabled, url: dto.url.trim(), nationalCodeParam: dto.nationalCodeParam, authHeader: dto.authHeader, perMinute: dto.perMinute, secret: dto.secret ? this.crypto.encrypt(dto.secret) : cur.secret };
    await this.prisma.unscoped().tenant.update({ where: { id: insurerId }, data: { coverageConfig: next as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: insurerId, targetType: 'CoverageConfig', targetId: insurerId, metadata: { enabled: next.enabled, url: next.url, perMinute: next.perMinute } });
    return { ok: true };
  }

  /** Try the saved connection with one کد ملی, without touching any case. */
  @Post(':insurerId/coverage/test')
  async testCoverage(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: CoverageTestDto) {
    const t = await this.insurer(insurerId);
    const cfg = coverageFrom(t.coverageConfig);
    if (!cfg.url) throw new BadRequestException('نشانی سرویس ثبت نشده است');
    try { return { ok: true, ...(await this.coverage.ask(cfg, dto.nationalCode)) }; }
    catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  }
}
