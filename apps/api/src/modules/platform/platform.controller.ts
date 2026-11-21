import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ShahkarService } from '../auth/shahkar.service';
import { IbanMatchService } from '../model-view/iban-match.service';
import { ReceiptSmsService } from '../notifications/receipt-sms.service';
import { IsInt, Matches, Max, Min } from 'class-validator';
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

const FIELD = /^[\w\-.]*$/;
class IbanMatchDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(0, 30) provider?: string;
  @IsOptional() @IsString() @Length(0, 500) url?: string;
  @IsOptional() @IsIn(['GET', 'POST']) method?: 'GET' | 'POST';
  @IsOptional() @IsString() @Length(1, 60) @Matches(FIELD) authHeader?: string;
  @IsOptional() @IsString() @Length(0, 30) authPrefix?: string;
  @IsOptional() @IsString() @Length(0, 2000) token?: string;
  @IsOptional() @IsBoolean() clearToken?: boolean;
  @IsOptional() @IsString() @Length(1, 60) @Matches(FIELD) nationalCodeField?: string;
  @IsOptional() @IsString() @Length(1, 60) @Matches(FIELD) ibanField?: string;
  @IsOptional() @IsString() @Length(0, 60) @Matches(FIELD) birthDateField?: string;
  @IsOptional() @IsIn(['JALALI', 'GREGORIAN']) birthDateFormat?: 'JALALI' | 'GREGORIAN';
  @IsOptional() @IsString() @Length(0, 2000) extraParams?: string;
  @IsOptional() @IsString() @Length(1, 120) @Matches(FIELD) matchPath?: string;
  @IsOptional() @IsString() @Length(1, 200) matchValues?: string;
  @IsOptional() @IsInt() @Min(2) @Max(60) timeoutSec?: number;
}
class IbanTestDto {
  @IsString() @Matches(/^\d{10}$/) nationalCode!: string;
  @IsString() @Length(24, 34) iban!: string;
  @IsOptional() @IsString() @Length(0, 12) birthDate?: string;
}

class ReceiptSmsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['FILE', 'SUBMIT']) when?: 'FILE' | 'SUBMIT';
  @IsOptional() @IsIn(['PLATFORM', 'ORG']) gateway?: 'PLATFORM' | 'ORG';
  @IsOptional() @IsString() @Length(1, 500) template?: string;
}
class ReceiptTestDto {
  @IsString() @Matches(/^(\+98|0)?9\d{9}$/) phone!: string;
}

class SetPlatformSmsDto {
  @IsBoolean()
  enabled!: boolean;
}

/** Platform-only (super-admin): host SMS gateway + which orgs may use it. */
@SuperAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService, private readonly shahkarSvc: ShahkarService, private readonly iban: IbanMatchService, private readonly receipt: ReceiptSmsService) {}

  /** «پیامک کد پذیرش» to whoever filed a case: on/off, when, gateway, text. */
  @Get('receipt-sms')
  receiptSms() {
    return this.receipt.settings();
  }

  @Put('receipt-sms')
  setReceiptSms(@Body() dto: ReceiptSmsDto) {
    return this.receipt.save(dto);
  }

  /** A test SMS with sample values. */
  @Post('receipt-sms/test')
  testReceiptSms(@Body() dto: ReceiptTestDto) {
    return this.receipt.test(dto.phone);
  }

  /** «استعلام تطابق شبا و کد ملی» of ذینفعان: on/off + the provider's call. */
  @Get('iban-match')
  ibanMatch() {
    return this.iban.settings();
  }

  @Put('iban-match')
  setIbanMatch(@Body() dto: IbanMatchDto) {
    return this.iban.save(dto);
  }

  /** Try the saved settings with a real کد ملی / شبا (works while switched off; shows the raw reply). */
  @Post('iban-match/test')
  testIbanMatch(@Body() dto: IbanTestDto) {
    return this.iban.check(dto.nationalCode, dto.iban, dto.birthDate, true);
  }

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

  /** Panel 3 login: کد ملی + mobile (OTP) on, کد ملی + password off. */
  @Put('inquiry-phone-login')
  setInquiryPhoneLogin(@Body() dto: SetPlatformSmsDto) {
    return this.platform.setInquiryPhoneLogin(!!dto.enabled);
  }
}
