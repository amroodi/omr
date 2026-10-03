import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/rbac/decorators';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { ClaimsService } from '../claims/claims.service';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerService } from './customer.service';
import { CustomerRequestOtpDto, CustomerVerifyOtpDto } from './dto';

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly customer: CustomerService,
    private readonly claims: ClaimsService,
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

  // ── بیمه‌گزار claim self-service (ownership enforced inside ClaimsService) ──
  @UseGuards(JwtAuthGuard)
  @Get('claims')
  myClaims() {
    return this.claims.listMine();
  }

  @UseGuards(JwtAuthGuard)
  @Get('claims/:id')
  claim(@Param('id') id: string) {
    return this.claims.get(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('claims/:id/checklist')
  claimChecklist(@Param('id') id: string) {
    return this.claims.checklist(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('claims/:id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadClaimDoc(@Param('id') id: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File) {
    return this.claims.uploadDocument(id, file, docCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('claims/:id/rectify')
  rectify(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.claims.rectify(id, body?.note);
  }
}
