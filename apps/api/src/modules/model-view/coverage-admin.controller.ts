import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { CoverageConfig, CoverageService, coverageFrom, coverageMessage, judgeCoverage, readCoverage } from './coverage.service';

const NAME = /^[\w\-.؀-ۿ‌ ]*$/; // a parameter / header / column name (Persian columns allowed)

class FieldsDto {
  @IsString() @Length(1, 80) @Matches(NAME) valid!: string;
  @IsString() @Length(0, 80) @Matches(NAME) firstName!: string;
  @IsString() @Length(0, 80) @Matches(NAME) lastName!: string;
  @IsString() @Length(0, 80) @Matches(NAME) insuredCode!: string;
  @IsString() @Length(0, 80) @Matches(NAME) birthYear!: string;
  @IsString() @Length(0, 80) @Matches(NAME) nationalCode!: string;
  @IsString() @Length(0, 80) @Matches(NAME) policyNumber!: string;
  @IsString() @Length(0, 80) @Matches(NAME) policyStart!: string;
  @IsString() @Length(0, 80) @Matches(NAME) policyEnd!: string;
}
class CoverageDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Length(0, 500) url!: string;
  @IsIn(['GET', 'POST']) method!: 'GET' | 'POST';
  @IsString() @Length(1, 60) @Matches(/^[\w-]+$/) nationalCodeParam!: string;
  @IsString() @Length(0, 2000) extraParams!: string;
  @IsString() @Length(1, 60) @Matches(/^[\w-]+$/) authHeader!: string;
  @IsOptional() @IsString() @Length(0, 2000) secret?: string; // empty/absent keeps the stored one
  @IsOptional() @IsBoolean() clearSecret?: boolean;
  @IsInt() @Min(2) @Max(60) timeoutSec!: number;
  @IsInt() @Min(1) @Max(600) perMinute!: number;
  @IsString() @Length(0, 120) @Matches(/^[\w.]*$/) rowsPath!: string;
  @ValidateNested() @Type(() => FieldsDto) fields!: FieldsDto;
  @IsString() @Length(1, 200) validValues!: string;
  @IsIn(['BLOCK', 'WARN']) onUncovered!: 'BLOCK' | 'WARN';
  @IsIn(['ALLOW', 'BLOCK']) onUnavailable!: 'ALLOW' | 'BLOCK';
  @IsBoolean() checkPeriod!: boolean;
  @IsBoolean() autoFill!: boolean;
  @IsBoolean() matchPolicy!: boolean;
}
class CoverageTestDto {
  @IsString() @Matches(/^\d{10}$/) nationalCode!: string;
  @IsOptional() @IsISO8601() eventDate?: string;
}

/** The settings as the page sees them: the secret is write-only. */
const view = (c: CoverageConfig) => { const { secret, ...rest } = c; return { ...rest, hasSecret: !!secret }; };

/**
 * Super Admin › «اتصال فن‌آوران»: one connection per insurer to its issuing system — where to call, how to
 * sign the call, how to read the reply (their column names), and what the answer does to a new case.
 * Every save is audited (never the secret). Off until switched on here.
 */
@SuperAdminOnly()
@Controller('admin/coverage')
export class CoverageAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coverage: CoverageService,
    private readonly crypto: FieldCryptoService,
  ) {}

  private async insurer(id: string) {
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id }, select: { kind: true, name: true, coverageConfig: true } });
    if (!t || t.kind !== 'INSURER') throw new NotFoundException('بیمه‌گر یافت نشد');
    return t;
  }

  @Get()
  async list() {
    const db = this.prisma.unscoped();
    const insurers = await db.tenant.findMany({ where: { kind: 'INSURER' }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true, coverageConfig: true } });
    const counts = await db.claim.groupBy({ by: ['insurerTenantId', 'coverageStatus'], where: { insurerTenantId: { in: insurers.map((i) => i.id) }, coverageStatus: { not: null }, deletedAt: null }, _count: true });
    const n = (id: string, s: string) => counts.find((c) => c.insurerTenantId === id && c.coverageStatus === s)?._count ?? 0;
    return insurers.map((t) => ({
      id: t.id, name: t.name, isActive: t.isActive, config: view(coverageFrom(t.coverageConfig)),
      cases: { valid: n(t.id, 'VALID'), invalid: n(t.id, 'INVALID') + n(t.id, 'NOT_FOUND'), notChecked: n(t.id, 'NOT_CHECKED') },
    }));
  }

  @Put(':insurerId')
  async save(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: CoverageDto) {
    const t = await this.insurer(insurerId);
    const cur = coverageFrom(t.coverageConfig);
    const url = dto.url.trim();
    if (dto.enabled && !url) throw new BadRequestException('پیش از فعال‌سازی، نشانی سرویس را وارد کنید');
    if (url) this.coverage.assertUrl(url);
    const { secret, clearSecret, ...rest } = dto;
    const next: CoverageConfig = { ...rest, url, extraParams: dto.extraParams.trim(), rowsPath: dto.rowsPath.trim(), secret: clearSecret ? null : secret ? this.crypto.encrypt(secret) : cur.secret };
    await this.prisma.unscoped().tenant.update({ where: { id: insurerId }, data: { coverageConfig: next as unknown as Prisma.InputJsonValue } });
    const { secret: _s, ...logged } = next;
    await this.audit.record({ action: AuditAction.EDIT, tenantId: insurerId, targetType: 'CoverageConfig', targetId: insurerId, metadata: { ...logged, secretChanged: !!secret || !!clearSecret } as any });
    return view(next);
  }

  /**
   * Try the saved connection with one کد ملی, without touching any case: the raw reply, how it was read,
   * and what it would do to a new case.
   */
  @Post(':insurerId/test')
  async test(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: CoverageTestDto) {
    const t = await this.insurer(insurerId);
    const cfg = coverageFrom(t.coverageConfig);
    if (!cfg.url) throw new BadRequestException('نشانی سرویس ثبت نشده است');
    const started = Date.now();
    let call: { httpStatus: number; body: unknown };
    try { call = await this.coverage.call(cfg, dto.nationalCode); }
    catch (e: any) { return { ok: false, ms: Date.now() - started, error: String(e?.message ?? e), effect: cfg.onUnavailable === 'BLOCK' ? 'ثبت پرونده تا برگشت سرویس رد می‌شود' : 'پرونده ثبت و «بررسی‌نشده» علامت می‌خورد؛ بعداً خودکار بررسی می‌شود' }; }
    const raw = typeof call.body === 'string' ? call.body : JSON.stringify(call.body, null, 2);
    const base = { ok: true, ms: Date.now() - started, httpStatus: call.httpStatus, raw: raw.length > 6000 ? `${raw.slice(0, 6000)}\n…` : raw };
    try {
      const read = call.httpStatus === 404 ? { status: 'NOT_FOUND' as const, person: null, policy: null }
        : call.httpStatus < 200 || call.httpStatus >= 300 ? (() => { throw new Error(`سرویس پاسخ ${call.httpStatus} داد`); })()
        : typeof call.body === 'string' ? (() => { throw new Error('پاسخ سرویس JSON نیست'); })()
        : readCoverage(call.body, cfg, dto.nationalCode);
      const result = judgeCoverage(read, cfg, dto.eventDate ? new Date(dto.eventDate) : null);
      const blocked = result.status !== 'VALID' && cfg.onUncovered === 'BLOCK';
      return { ...base, result, message: coverageMessage(result), effect: result.status === 'VALID' ? 'پرونده ثبت می‌شود' : blocked ? 'ثبت پرونده رد می‌شود' : 'پرونده با هشدار ثبت می‌شود' };
    } catch (e: any) {
      return { ...base, readError: String(e?.message ?? e) };
    }
  }

  /** Re-check this insurer's «بررسی‌نشده» cases now (one batch, at its rate limit). */
  @Post(':insurerId/recheck')
  async recheck(@Param('insurerId', ParseUUIDPipe) insurerId: string) {
    await this.insurer(insurerId);
    const r = await this.coverage.retrySweep(insurerId);
    const remaining = await this.prisma.unscoped().claim.count({ where: { insurerTenantId: insurerId, coverageStatus: 'NOT_CHECKED', deletedAt: null } });
    return { ...r, remaining };
  }
}
