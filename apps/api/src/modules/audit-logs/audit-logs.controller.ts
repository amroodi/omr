import { Controller, Get, Query } from '@nestjs/common';
import { Permissions, SuperAdminOnly } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { AuditLogsService } from './audit-logs.service';
import { AuditQueryDto, GlobalAuditQueryDto } from './dto';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  /** Org audit trail — the caller's own tenant. */
  @Permissions(PERMISSIONS.AUDIT_READ)
  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.auditLogs.list(query);
  }

  /** Verify the tenant's hash chain is intact (tamper evidence). */
  @Permissions(PERMISSIONS.AUDIT_READ)
  @Get('integrity')
  integrity() {
    return this.auditLogs.integrity();
  }

  /** Platform-wide audit trail across all tenants (super-admin only). */
  @SuperAdminOnly()
  @Get('global')
  global(@Query() query: GlobalAuditQueryDto) {
    return this.auditLogs.globalList(query);
  }
}
