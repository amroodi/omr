import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KIND_CODE, activeKinds } from '../../common/kinds';
import { Permissions, SuperAdminOnly } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { asOrg } from '../../common/tenant/as-org';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { AdminCompanyEditDto, AdminContractDto, AdminContractEditDto, AdminPasswordDto } from './policyholders-admin.controller';
import { PolicyholdersAdminService } from './policyholders-admin.service';
import { AssignCompanyDto } from './dto';
import { PolicyholdersService } from './policyholders.service';

class ManageCompanyDto {
  @IsString() @Length(2, 160) name!: string;
  @IsString() @Length(1, 40) code!: string;
  // Optional first بیمه‌نامه
  @IsOptional() @IsUUID() insurerTenantId?: string;
  @IsOptional() @IsString() @Matches(KIND_CODE) line?: string;
  @IsOptional() @IsString() @Length(0, 60) policyNumber?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() endDate?: string | null;
}

/**
 * A brokerage's admin (panel 2 › «بیمه‌گزاران») manages its own بیمه‌گزار companies: the panel-1 login
 * (کد بیمه‌گزار + password) and the yearly بیمه‌نامه‌ها. Same rules as Super Admin's page, limited to the
 * brokerage's own companies and to insurers it already cooperates with (only Super Admin connects a
 * brokerage to a new insurer).
 */
@Controller('policyholder-companies/manage')
export class PolicyholdersManageController {
  constructor(private readonly prisma: PrismaService, private readonly svc: PolicyholdersAdminService) {}

  private async broker(): Promise<string> {
    const id = getTenantIdOrThrow();
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id }, select: { kind: true } });
    if (t?.kind !== 'BROKER') throw new ForbiddenException('شرکت‌های بیمه‌گزار فقط در پنل کارگزاری مدیریت می‌شوند');
    return id;
  }

  private async own(id: string): Promise<string> {
    const brokerId = await this.broker();
    const co = await this.prisma.unscoped().policyholderCompany.findFirst({ where: { id, tenantId: brokerId }, select: { id: true } });
    if (!co) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
    return brokerId;
  }

  private async partner(brokerId: string, insurerId: string) {
    const p = await this.prisma.unscoped().brokerInsurerPartnership.findFirst({ where: { brokerTenantId: brokerId, insurerTenantId: insurerId, isActive: true }, select: { id: true } });
    if (!p) throw new BadRequestException('این کارگزاری با این بیمه‌گر همکاری فعال ندارد؛ اتصال به بیمه‌گر را مدیر سامانه برقرار می‌کند');
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get()
  async list(@Query('q') q?: string) {
    return this.svc.list(await this.broker(), q);
  }

  /** Insurers the brokerage cooperates with, and the policy kinds, for the بیمه‌نامه form. */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get('options')
  async options() {
    const brokerId = await this.broker();
    const parts = await this.prisma.unscoped().brokerInsurerPartnership.findMany({ where: { brokerTenantId: brokerId, isActive: true }, select: { insurerTenantId: true } });
    const insurers = parts.length
      ? await this.prisma.unscoped().tenant.findMany({ where: { id: { in: parts.map((p) => p.insurerTenantId) }, kind: 'INSURER', isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
      : [];
    return { insurers, kinds: activeKinds().map((k) => ({ code: k.code, label: k.label })) };
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post()
  async create(@Body() dto: ManageCompanyDto) {
    const brokerId = await this.broker();
    if (dto.insurerTenantId && dto.policyNumber?.trim()) await this.partner(brokerId, dto.insurerTenantId);
    return this.svc.create({ ...dto, brokerTenantId: brokerId });
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminCompanyEditDto) {
    await this.own(id);
    return this.svc.update(id, dto);
  }

  /** Deleted with its بیمه‌نامه‌ها and نمایندگان — refused while it has cases. */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.own(id);
    return this.svc.remove([id]);
  }

  /** Set (or reset to the default) the company's panel password; the new password is shown once. */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post(':id/password')
  async password(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminPasswordDto) {
    await this.own(id);
    return this.svc.setPassword(id, dto.password);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post(':id/contracts')
  async addContract(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminContractDto) {
    await this.partner(await this.own(id), dto.insurerTenantId);
    return this.svc.addContract(id, dto);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Patch(':id/contracts/:contractId')
  async editContract(@Param('id', ParseUUIDPipe) id: string, @Param('contractId', ParseUUIDPipe) contractId: string, @Body() dto: AdminContractEditDto) {
    const brokerId = await this.own(id);
    if (dto.insurerTenantId) await this.partner(brokerId, dto.insurerTenantId);
    return this.svc.updateContract(id, contractId, dto);
  }
}

/** Super Admin › «کاربران پنل‌ها»: a brokerage's companies (for the نمایندگان tab's picker) and attaching a نماینده. */
@SuperAdminOnly()
@Controller('admin/operators/:tenantId/policyholder-companies')
export class PolicyholdersOperatorsController {
  constructor(private readonly prisma: PrismaService, private readonly companies: PolicyholdersService) {}

  @Get()
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return asOrg(this.prisma, tenantId, () => this.companies.list(tenantId), 'BROKER');
  }

  @Put('accounts/:accountId')
  assign(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('accountId', ParseUUIDPipe) accountId: string, @Body() dto: AssignCompanyDto) {
    return asOrg(this.prisma, tenantId, () => this.companies.assignAccount(accountId, dto.companyId ?? null), 'BROKER');
  }
}
