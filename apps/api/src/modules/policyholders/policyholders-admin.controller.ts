import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InsuranceLine } from '@prisma/client';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { PolicyholdersAdminService } from './policyholders-admin.service';

class AdminCompanyDto {
  @IsUUID() brokerTenantId!: string;
  @IsString() @Length(2, 160) name!: string;
  @IsString() @Length(1, 40) code!: string;
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
class AdminContractActiveDto {
  @IsBoolean() isActive!: boolean;
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

  @Post(':id/password')
  password(@Param('id') id: string, @Body() dto: AdminPasswordDto) {
    return this.svc.setPassword(id, dto.password);
  }

  @Post(':id/contracts')
  addContract(@Param('id') id: string, @Body() dto: AdminContractDto) {
    return this.svc.addContract(id, dto);
  }

  @Patch(':id/contracts/:contractId')
  contractActive(@Param('id') id: string, @Param('contractId') contractId: string, @Body() dto: AdminContractActiveDto) {
    return this.svc.setContractActive(id, contractId, dto.isActive);
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
