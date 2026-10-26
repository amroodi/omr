import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InsuranceLine } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { PolicyholdersAdminService } from './policyholders-admin.service';

class AdminCompanyDto {
  @IsUUID() brokerTenantId!: string;
  @IsString() @Length(2, 160) name!: string;
  @IsString() @Length(1, 40) code!: string;
  // Optional first بیمه‌نامه
  @IsOptional() @IsUUID() insurerTenantId?: string;
  @IsOptional() @IsEnum(InsuranceLine) line?: InsuranceLine;
  @IsOptional() @IsString() @Length(0, 60) policyNumber?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() endDate?: string | null;
}
class BrokerSettingsDto {
  @IsUUID() brokerTenantId!: string;
  @IsOptional() @IsBoolean() manualCompletion?: boolean;
  @IsOptional() @IsString() @Length(8, 200) brokerPassword?: string;
}
class AdminCompanyEditDto {
  @IsOptional() @IsString() @Length(2, 160) name?: string;
  @IsOptional() @IsString() @Length(0, 40) code?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AdminPasswordDto {
  @IsOptional() @IsString() @Length(0, 200) password?: string;
}
class AdminContractDto {
  @IsUUID() insurerTenantId!: string;
  @IsEnum(InsuranceLine) line!: InsuranceLine;
  @IsString() @Length(1, 60) policyNumber!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() endDate?: string | null;
}
class AdminContractEditDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsEnum(InsuranceLine) line?: InsuranceLine;
  @IsOptional() @IsString() @Length(1, 60) policyNumber?: string;
  @IsOptional() @IsUUID() insurerTenantId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsISO8601() endDate?: string | null;
}
/** Delete the listed companies (`ids`), or — with `all` — every company of `brokerTenantId` matching `q`. */
class AdminDeleteDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsUUID() brokerTenantId?: string;
  @IsOptional() @IsString() @Length(0, 100) q?: string;
}

/** Super admin: every brokerage's بیمه‌گزار companies, their panel logins and yearly بیمه‌نامه‌ها. */
@SuperAdminOnly()
@Controller('admin/policyholders')
export class PolicyholdersAdminController {
  constructor(private readonly svc: PolicyholdersAdminService) {}

  @Get('options')
  options() {
    return this.svc.options();
  }

  /** «تکمیل دستی پرونده» switch and the «broker» login password of a brokerage. */
  @Post('broker-settings')
  brokerSettings(@Body() dto: BrokerSettingsDto) {
    return this.svc.brokerSettings(dto.brokerTenantId, dto);
  }

  @Get()
  list(@Query('brokerTenantId') brokerTenantId?: string, @Query('q') q?: string) {
    return this.svc.list(brokerTenantId || undefined, q);
  }

  @Post()
  create(@Body() dto: AdminCompanyDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminCompanyEditDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove([id]);
  }

  /** Batch («حذف انتخاب‌شده‌ها») or bulk («حذف همهٔ نتایج») delete. */
  @Post('delete')
  removeMany(@Body() dto: AdminDeleteDto) {
    if (dto.all) {
      if (!dto.brokerTenantId) throw new BadRequestException('کارگزاری را انتخاب کنید');
      return this.svc.removeMatching(dto.brokerTenantId, dto.q);
    }
    if (!dto.ids?.length) throw new BadRequestException('هیچ بیمه‌گزاری انتخاب نشده است');
    return this.svc.remove(dto.ids);
  }

  @Post(':id/password')
  password(@Param('id') id: string, @Body() dto: AdminPasswordDto) {
    return this.svc.setPassword(id, dto.password);
  }

  @Post(':id/contracts')
  addContract(@Param('id') id: string, @Body() dto: AdminContractDto) {
    return this.svc.addContract(id, dto);
  }

  @Patch(':id/contracts/:contractId')
  editContract(@Param('id') id: string, @Param('contractId') contractId: string, @Body() dto: AdminContractEditDto) {
    return this.svc.updateContract(id, contractId, dto);
  }

  /** The insurer's yearly export (sheets «عمر جاری» / «حوادث جاری»). */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  import(@UploadedFile() file: Express.Multer.File, @Body() body: { brokerTenantId?: string; insurerTenantId?: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (!body.brokerTenantId || !body.insurerTenantId) throw new BadRequestException('کارگزاری و بیمه‌گر را انتخاب کنید');
    return this.svc.importExcel(file.buffer, body.brokerTenantId, body.insurerTenantId);
  }
}
