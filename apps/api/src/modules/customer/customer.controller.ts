import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/rbac/decorators';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerService } from './customer.service';
import { CustomerRequestOtpDto, CustomerVerifyOtpDto } from './dto';

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly customer: CustomerService,
  ) {}

  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('login/request-otp')
  requestOtp(@Body() dto: CustomerRequestOtpDto) {
    return this.auth.requestOtp(dto.nationalCode, dto.phone);
  }

  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('login/verify-otp')
  verifyOtp(@Body() dto: CustomerVerifyOtpDto) {
    return this.auth.verifyOtp(dto.nationalCode, dto.phone, dto.code);
  }

  /** Customer dashboard — the caller's own cases only (requires a `customer` token). */
  @UseGuards(JwtAuthGuard)
  @Get('cases')
  myCases() {
    return this.customer.myCases();
  }
}
