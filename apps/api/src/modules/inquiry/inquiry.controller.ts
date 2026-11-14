import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public, Realms } from '../../common/rbac/decorators';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { InquiryMessageDto, InquiryPasswordDto, PasswordLoginDto, RequestOtpDto, VerifyOtpDto } from './dto';
import { InquiryService } from './inquiry.service';

@Controller('inquiry')
export class InquiryController {
  constructor(private readonly inquiry: InquiryService) {}

  /** Step 1 — public: verify (nationalCode + phone) and send OTP. Tenant from header/subdomain. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.inquiry.requestOtp(dto);
  }

  /** استعلام سریع — look up a death-claim by the DECEASED's National ID; OTP goes to the checker's own phone. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('request-claim')
  requestClaim(@Body() dto: RequestOtpDto) {
    return this.inquiry.requestClaimStatus(dto);
  }

  /** Deceased-NID claim view with no code — only when OTP is disabled platform-wide. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('claim-direct')
  claimDirect(@Body() dto: RequestOtpDto) {
    return this.inquiry.directClaimStatus(dto);
  }

  /** Step 2 — public: verify OTP, receive a short-lived record-scoped token. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.inquiry.verifyOtp(dto);
  }

  /** Direct record view with no code — only works when OTP is disabled platform-wide. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('direct')
  direct(@Body() dto: RequestOtpDto) {
    return this.inquiry.directVerify(dto);
  }

  /** How panel 3 logs in: کد ملی + mobile (OTP), or کد ملی + password (Super Admin's switch). */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Get('login-config')
  loginConfig() {
    return this.inquiry.loginConfig();
  }

  /** Panel 3 with the phone field off: کد ملی + password. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('password-login')
  passwordLogin(@Body() dto: PasswordLoginDto) {
    return this.inquiry.passwordLogin(dto);
  }

  /** The کد ملی holder changes their panel-3 password (password logins only). */
  @Realms('RECORD')
  @UseGuards(JwtAuthGuard)
  @Post('password')
  changePassword(@Body() dto: InquiryPasswordDto) {
    return this.inquiry.changePassword(dto.current, dto.next);
  }

  /** Step 3 — requires the record token from step 2. Returns that one case only. */
  @Realms('RECORD')
  @UseGuards(JwtAuthGuard)
  @Get('case')
  getCase(@Query('claimId') claimId?: string) {
    return this.inquiry.getScopedCase(claimId);
  }

  /** Every case the looked-up کد ملی covers (the person's, and a main insured's dependents'). */
  @Realms('RECORD')
  @UseGuards(JwtAuthGuard)
  @Get('cases')
  getCases() {
    return this.inquiry.listScopedClaims();
  }

  /** «پاسخگوی آنلاین» — the requester (record token) leaves a question for the بیمه‌گزار / کارگزاری. */
  @Realms('RECORD')
  @UseGuards(JwtAuthGuard)
  @Post('message')
  message(@Body() dto: InquiryMessageDto) {
    return this.inquiry.leaveMessage(dto.message, dto.claimId, dto.phone);
  }

  /** «گفتگو» — the requester's questions and the کارگزاری's answers on this claim. */
  @Realms('RECORD')
  @UseGuards(JwtAuthGuard)
  @Get('messages')
  messages(@Query('claimId') claimId?: string, @Query('phone') phone?: string) {
    return this.inquiry.thread(claimId, phone);
  }
}
