import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/rbac/decorators';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { RequestOtpDto, VerifyOtpDto } from './dto';
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

  /** Step 2 — public: verify OTP, receive a short-lived record-scoped token. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.inquiry.verifyOtp(dto);
  }

  /** Step 3 — requires the record token from step 2. Returns that one case only. */
  @UseGuards(JwtAuthGuard)
  @Get('case')
  getCase() {
    return this.inquiry.getScopedCase();
  }
}
