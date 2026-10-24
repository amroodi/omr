import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permissions, Public } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { AssignCompanyDto, CompanyDto, ContractDto, PartnerDto } from './dto';
import { PolicyholdersService } from './policyholders.service';

/** بیمه‌گزار companies of a brokerage + their insurer contracts (کارگزاری panel). */
@Controller('policyholder-companies')
export class PolicyholdersController {
  constructor(private readonly svc: PolicyholdersService) {}

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get()
  list() {
    return this.svc.list();
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post()
  create(@Body() dto: CompanyDto) {
    return this.svc.create(dto);
  }

  /** «نقشهٔ اتصال‌ها»: companies → this brokerage → insurers. */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get('network')
  network() {
    return this.svc.network();
  }

  /** The brokerage connects to (or ends cooperation with) an insurer registered on the platform. */
  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Put('partners/:insurerId')
  setPartner(@Param('insurerId') insurerId: string, @Body() dto: PartnerDto) {
    return this.svc.setPartner(insurerId, dto.enabled);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('messages')
  messages() {
    return this.svc.messages();
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post('messages/:id/handled')
  handled(@Param('id') id: string) {
    return this.svc.markMessageHandled(id);
  }

  /** Public: company search for the استعلام form (tenant from slug; ≥2 letters, ≤10 results). */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('search')
  search(@Query('q') q: string) {
    return this.svc.search(q);
  }

  /** Public: a company's logo (shown in the بیمه‌گزار panel and on the استعلام result). */
  @Public()
  @Get(':id/logo')
  async logo(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mime } = await this.svc.logo(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    // Public image shown on other origins (web panel, استعلام page) — like the tenant logo.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CompanyDto) {
    return this.svc.update(id, dto);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.uploadLogo(id, file);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post(':id/contracts')
  addContract(@Param('id') id: string, @Body() dto: ContractDto) {
    return this.svc.addContract(id, dto);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Patch(':id/contracts/:contractId')
  updateContract(@Param('id') id: string, @Param('contractId') contractId: string, @Body() dto: ContractDto) {
    return this.svc.updateContract(id, contractId, dto);
  }

  /** Attach / detach a بیمه‌گزار representative account. */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Put('accounts/:accountId')
  assign(@Param('accountId') accountId: string, @Body() dto: AssignCompanyDto) {
    return this.svc.assignAccount(accountId, dto.companyId ?? null);
  }
}
