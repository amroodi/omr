import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CustomerSignupStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { asOrg } from '../../common/tenant/as-org';
import { AccountPasswordDto, AccountUpdateDto, AgentDto, AgentUpdateDto, CreateCustomerDto } from './customer.controller';
import { CustomerService } from './customer.service';

/**
 * Super Admin › «کاربران پنل‌ها»: an organization's panel-1 people, as its own admin manages them —
 * a brokerage's نمایندگان (of its بیمه‌گزار companies), an insurer's نمایندگان بیمه.
 */
@SuperAdminOnly()
@Controller('admin/operators/:tenantId/customer')
export class CustomerAdminController {
  constructor(private readonly prisma: PrismaService, private readonly customer: CustomerService) {}

  // ── A brokerage's نمایندگان ──
  @Get('accounts')
  accounts(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Query('status') status?: string) {
    const s = status && (['PENDING', 'ACTIVE', 'REJECTED'] as const).includes(status as any) ? (status as CustomerSignupStatus) : undefined;
    return asOrg(this.prisma, tenantId, () => this.customer.listAccounts(s), 'BROKER');
  }

  @Get('accounts/pending-count')
  pending(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return asOrg(this.prisma, tenantId, () => this.customer.pendingCount(), 'BROKER');
  }

  @Post('accounts')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateCustomerDto) {
    return asOrg(this.prisma, tenantId, () => this.customer.createAccount(dto), 'BROKER');
  }

  @Patch('accounts/:id')
  update(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AccountUpdateDto) {
    return asOrg(this.prisma, tenantId, () => this.customer.updateAccount(id, dto), 'BROKER');
  }

  @Post('accounts/:id/approve')
  approve(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return asOrg(this.prisma, tenantId, () => this.customer.approve(id), 'BROKER');
  }

  @Post('accounts/:id/reject')
  reject(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return asOrg(this.prisma, tenantId, () => this.customer.reject(id), 'BROKER');
  }

  // ── Both kinds: password and removal of a نماینده / نماینده بیمه ──
  @Post('accounts/:id/password')
  password(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AccountPasswordDto) {
    return asOrg(this.prisma, tenantId, () => this.customer.setAccountPassword(id, dto.password));
  }

  @Delete('accounts/:id')
  remove(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return asOrg(this.prisma, tenantId, () => this.customer.removeAccount(id));
  }

  // ── An insurer's نمایندگان بیمه ──
  @Get('agents')
  agents(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return asOrg(this.prisma, tenantId, () => this.customer.listAgents(), 'INSURER');
  }

  @Post('agents')
  addAgent(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: AgentDto) {
    return asOrg(this.prisma, tenantId, () => this.customer.addAgent(dto), 'INSURER');
  }

  @Patch('agents/:id')
  updateAgent(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgentUpdateDto) {
    return asOrg(this.prisma, tenantId, () => this.customer.updateAgent(id, dto), 'INSURER');
  }
}
