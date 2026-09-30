import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { GrantShareDto } from './dto';
import { SharingService } from './sharing.service';

/**
 * An org admin manages who their organization shares data with. Guarded by tenant:settings, so
 * only organization-level admins (not ordinary staff) can open or close data sharing.
 */
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('outgoing')
  outgoing() {
    return this.sharing.listOutgoing();
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('incoming')
  incoming() {
    return this.sharing.listIncoming();
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Post('grant')
  grant(@Body() dto: GrantShareDto) {
    return this.sharing.grant(dto.partnerTenantId, dto.scope, dto.note);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.sharing.revoke(id);
  }
}
