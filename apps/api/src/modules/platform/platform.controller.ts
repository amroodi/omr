import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { SmsConfigDto, TestSmsDto } from '../branding/dto';
import { PlatformService } from './platform.service';

class SetPlatformSmsDto {
  @IsBoolean()
  enabled!: boolean;
}

/** Platform-only (super-admin): host SMS gateway + which orgs may use it. */
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('sms-config')
  getSmsConfig() {
    return this.platform.getSmsConfig();
  }

  @Put('sms-config')
  setSmsConfig(@Body() dto: SmsConfigDto) {
    return this.platform.setSmsConfig(dto);
  }

  @Post('sms-config/test')
  testSms(@Body() dto: TestSmsDto) {
    return this.platform.testSms(dto.phone);
  }

  @Get('sms-requests')
  smsRequests() {
    return this.platform.smsRequests();
  }

  @Post('tenants/:id/sms-platform')
  setTenantPlatformSms(@Param('id') id: string, @Body() dto: SetPlatformSmsDto) {
    return this.platform.setTenantPlatformSms(id, !!dto.enabled);
  }

  /** Toggle whether quick-inquiry (استعلام سریع) OTPs use the platform gateway. */
  @Put('inquiry-sms')
  setInquiryUsePlatform(@Body() dto: SetPlatformSmsDto) {
    return this.platform.setInquiryUsePlatform(!!dto.enabled);
  }
}
