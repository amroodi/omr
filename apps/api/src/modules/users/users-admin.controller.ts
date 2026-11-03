import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { asOrg } from '../../common/tenant/as-org';
import { MfaService } from '../auth/mfa.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

/**
 * Super Admin › «کاربران پنل‌ها»: every organization's own staff (کارکنان سازمان), managed exactly as
 * that organization's admin does in «کاربران و نقش‌ها» — same rules, same audit (with Super Admin as actor).
 */
@SuperAdminOnly()
@Controller('admin/operators')
export class UsersAdminController {
  constructor(private readonly prisma: PrismaService, private readonly users: UsersService, private readonly mfa: MfaService) {}

  /** Brokerages and insurers to pick from. */
  @Get()
  async orgs() {
    const rows = await this.prisma.unscoped().tenant.findMany({
      where: { kind: { in: ['BROKER', 'INSURER'] } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, kind: true, isActive: true },
    });
    return rows;
  }

  @Get(':tenantId/options')
  options(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return asOrg(this.prisma, tenantId, () => this.users.editorOptions());
  }

  @Get(':tenantId/users')
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return asOrg(this.prisma, tenantId, () => this.users.list());
  }

  @Post(':tenantId/users')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateUserDto) {
    return asOrg(this.prisma, tenantId, () => this.users.create(dto));
  }

  @Patch(':tenantId/users/:id')
  update(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return asOrg(this.prisma, tenantId, () => this.users.update(id, dto));
  }

  @Post(':tenantId/users/:id/reset-password')
  resetPassword(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return asOrg(this.prisma, tenantId, () => this.users.resetPassword(id, dto.password));
  }

  @Post(':tenantId/users/:id/mfa-reset')
  resetMfa(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return asOrg(this.prisma, tenantId, () => this.mfa.resetForUser(id));
  }

  @Delete(':tenantId/users/:id')
  remove(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return asOrg(this.prisma, tenantId, () => this.users.remove(id));
  }
}
