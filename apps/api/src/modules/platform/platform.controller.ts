import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ShahkarService } from '../auth/shahkar.service';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { SmsConfigDto, TestSmsDto } from '../branding/dto';
import { PlatformService } from './platform.service';

class ShahkarDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['finnotech', 'generic']) provider?: string;
  @IsOptional() @IsString() @Length(0, 300) baseUrl?: string;
  @IsOptional() @IsString() @Length(0, 120) clientId?: string;
  @IsOptional() @IsString() @Length(0, 2000) token?: string;
}

class SetPlatformSmsDto {
  @IsBoolean()
  enabled!: boolean;
}

/** Platform-only (super-admin): host SMS gateway + which orgs may use it. */
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService, private readonly shahkarSvc: ShahkarService) {}

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

  /** «استعلام شاهکار» (کد ملی ↔ شمارهٔ همراه of a نماینده): on/off + provider settings. */
  @Get('shahkar')
  shahkar() {
    return this.shahkarSvc.settings();
  }

  @Put('shahkar')
  setShahkar(@Body() dto: ShahkarDto) {
    return this.shahkarSvc.save(dto);
  }

  /** Master switch: require OTP on login/inquiry/signup, or allow proceeding without a code. */
  @Put('otp-enabled')
  setOtpEnabled(@Body() dto: SetPlatformSmsDto) {
    return this.platform.setOtpEnabled(!!dto.enabled);
  }
}
