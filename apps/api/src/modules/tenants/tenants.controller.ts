import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { ProvisionTenantDto, ResetAdminDto, SetTenantActiveDto } from './dto';
import { TenantsService } from './tenants.service';

/** Platform-only: provision and manage organizations (tenants). */
@SuperAdminOnly()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  provision(@Body() dto: ProvisionTenantDto) {
    return this.tenants.provision(dto);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: SetTenantActiveDto) {
    return this.tenants.setActive(id, dto.isActive);
  }

  @Post(':id/reset-admin')
  resetAdmin(@Param('id') id: string, @Body() dto: ResetAdminDto) {
    return this.tenants.resetAdminPassword(id, dto.username ?? 'admin');
  }
}
