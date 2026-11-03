import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { activeKinds } from '../../common/kinds';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Public, SuperAdminOnly } from '../../common/rbac/decorators';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { KindsService } from './kinds.service';

class KindRowDto {
  @IsOptional() @IsString() @Length(0, 32) code?: string;
  @IsString() @Length(2, 60) label!: string;
  @IsBoolean() active!: boolean;
}
class KindsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => KindRowDto) kinds!: KindRowDto[];
}
class OrgKindsDto {
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) kinds!: string[];
}

/** Super Admin › انواع بیمه‌نامه: the catalog, and which kinds each organization's panel 1 offers. */
@SuperAdminOnly()
@Controller('admin/policy-kinds')
export class KindsAdminController {
  constructor(private readonly kinds: KindsService) {}

  @Get()
  catalog() {
    return this.kinds.catalog();
  }

  @Put()
  save(@Body() dto: KindsDto) {
    return this.kinds.save(dto.kinds);
  }

  @Put('org/:tenantId')
  setOrg(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: OrgKindsDto) {
    return this.kinds.setOrgKinds(tenantId, dto.kinds);
  }
}

/** Public: the kinds one organization's panel 1 offers (its login drawer and top-bar switch). */
@Controller('tenant')
export class KindsPublicController {
  constructor(private readonly kinds: KindsService) {}

  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('policy-kinds')
  forOrg(@Query('all') all?: string) {
    // `all=1`: every active kind (panel 2 filters and shows every kind); else the organization's panel-1 kinds.
    return all === '1' ? activeKinds().map(({ code, label }) => ({ code, label })) : this.kinds.forOrg(getTenantIdOrThrow());
  }
}
