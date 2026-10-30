import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/rbac/decorators';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { InquiryMessageDto, RequestOtpDto, VerifyOtpDto } from './dto';
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

  /** Step 3 — requires the record token from step 2. Returns that one case only. */
  @UseGuards(JwtAuthGuard)
  @Get('case')
  getCase() {
    return this.inquiry.getScopedCase();
  }

  /** «پاسخگوی آنلاین» — the requester (record token) leaves a question for the بیمه‌گزار / کارگزاری. */
  @UseGuards(JwtAuthGuard)
  @Post('message')
  message(@Body() dto: InquiryMessageDto) {
    return this.inquiry.leaveMessage(dto.message);
  }

  /** «گفتگو» — the requester's questions and the کارگزاری's answers on this claim. */
  @UseGuards(JwtAuthGuard)
  @Get('messages')
  messages() {
    return this.inquiry.thread();
  }
}
