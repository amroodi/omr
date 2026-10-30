import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { BrandingService } from '../branding/branding.service';
import { DesignDto, UpdateBrandingDto } from '../branding/dto';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { ProvisionTenantDto, ResetAdminDto, SetPartnerDto, SetTenantActiveDto, UpdateTenantDto } from './dto';
import { TenantsService } from './tenants.service';

/** Platform-only: provision and manage organizations (tenants). */
@SuperAdminOnly()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService, private readonly branding: BrandingService) {}

  // ── «طراحی سازمان»: theme + logo of the organization and of each of its panels, and its admin settings ──
  @Get(':id/design')
  design(@Param('id') id: string) {
    return this.branding.getDesign(id);
  }

  @Put(':id/design')
  saveDesign(@Param('id') id: string, @Body() dto: DesignDto) {
    return this.branding.saveDesign(dto, id);
  }

  @Post(':id/design/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024 } }))
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Query('panel') panel?: string) {
    return this.branding.uploadLogo(file, panel || undefined, id);
  }

  @Delete(':id/design/logo')
  clearLogo(@Param('id') id: string, @Query('panel') panel: string) {
    return this.branding.clearPanelLogo(panel, id);
  }

  /** The designer's logo preview (any org, any panel). */
  @Get(':id/design/logo')
  async logo(@Param('id') id: string, @Res() res: Response, @Query('panel') panel?: string) {
    const { buffer, mime } = await this.branding.getLogo(id, panel || undefined);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  /** The organization admin's own settings («تنظیمات سازمان»), set up by the super admin. */
  @Get(':id/settings')
  settings(@Param('id') id: string) {
    return this.branding.getSettings(id);
  }

  @Patch(':id/settings')
  saveSettings(@Param('id') id: string, @Body() dto: UpdateBrandingDto) {
    return this.branding.updateSettings(dto, id);
  }

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Post(':id/reset-admin')
  resetAdmin(@Param('id') id: string, @Body() dto: ResetAdminDto) {
    return this.tenants.resetAdminPassword(id, dto.username ?? 'admin');
  }

  /** Insurers a brokerage works with (all insurers + a `partnered` flag). */
  @Get(':id/insurers')
  listPartners(@Param('id') id: string) {
    return this.tenants.listPartners(id);
  }

  @Post(':id/insurers')
  setPartner(@Param('id') id: string, @Body() dto: SetPartnerDto) {
    return this.tenants.setPartner(id, dto.insurerTenantId, dto.enabled);
  }
}
