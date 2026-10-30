import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Public } from '../../common/rbac/decorators';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { AssetKind, BrandingService } from './branding.service';
import { CarrierConfigDto, DesignDto, SmsConfigDto, TestSmsDto, UpdateBrandingDto } from './dto';

const ASSET_KINDS: AssetKind[] = ['logo', 'favicon', 'font'];
const assetLimits = { fileSize: 3 * 1024 * 1024 }; // 3 MB

function assertKind(kind: string): AssetKind {
  if (!ASSET_KINDS.includes(kind as AssetKind)) throw new BadRequestException('نوع فایل نامعتبر است');
  return kind as AssetKind;
}

@Controller('tenant')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  // ── Org admin: manage branding ──────────────────────────────────────────
  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('settings')
  getSettings() {
    return this.branding.getSettings();
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Patch('settings')
  updateSettings(@Body() dto: UpdateBrandingDto) {
    return this.branding.updateSettings(dto);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Post('assets/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: assetLimits }))
  uploadAsset(@Param('kind') kind: string, @UploadedFile() file: Express.Multer.File) {
    return this.branding.uploadAsset(assertKind(kind), file);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Put('carrier-config')
  setCarrierConfig(@Body() dto: CarrierConfigDto) {
    return this.branding.setCarrierConfig({ ...dto });
  }

  // ── Per-tenant SMS gateway ──
  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('sms-config')
  getSmsConfig() {
    return this.branding.getSmsConfig();
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Put('sms-config')
  setSmsConfig(@Body() dto: SmsConfigDto) {
    return this.branding.setSmsConfig(dto);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Post('sms-config/test')
  testSms(@Body() dto: TestSmsDto) {
    return this.branding.testSms(dto.phone);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Post('sms-config/request-platform')
  requestPlatformSms() {
    return this.branding.requestPlatformSms();
  }

  // ── Public: branding + assets for theming (tenant resolved from slug) ────
  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('branding')
  publicBranding(@Query('panel') panel?: string) {
    return this.branding.getPublicBranding(panel);
  }

  // ── «طراحی ظاهر»: the organization's and each panel's theme and logo ──
  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('design')
  design() {
    return this.branding.getDesign();
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Put('design')
  saveDesign(@Body() body: DesignDto) {
    return this.branding.saveDesign(body);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Post('design/logo')
  @UseInterceptors(FileInterceptor('file', { limits: assetLimits }))
  uploadDesignLogo(@UploadedFile() file: Express.Multer.File, @Query('panel') panel?: string) {
    return this.branding.uploadLogo(file, panel || undefined);
  }

  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Delete('design/logo')
  clearDesignLogo(@Query('panel') panel: string) {
    return this.branding.clearPanelLogo(panel);
  }

  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('assets/:kind')
  async asset(@Param('kind') kind: string, @Res() res: Response, @Query('panel') panel?: string) {
    const { buffer, mime } = await this.branding.getAsset(assertKind(kind), panel || undefined);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    // Public branding asset — allow cross-origin embedding (panel header, inquiry widget, etc.).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(buffer);
  }
}
