import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permissions, Public } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';

class CreateCustomerDto {
  @IsString() @Length(8, 12) nationalCode!: string;
  @IsString() @Matches(/^0?9\d{9}$/) phone!: string;
  @IsOptional() @IsString() @Length(2, 120) fullName?: string;
}
import { CustomerSignupStatus } from '@prisma/client';
import { ClaimsService } from '../claims/claims.service';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerService } from './customer.service';
import { CustomerFileClaimDto, CustomerRequestOtpDto, CustomerSignupDto, CustomerSignupVerifyDto, CustomerVerifyOtpDto } from './dto';

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

  // ── Public self-signup (choose an organization; creates a PENDING request) ──
  @Public()
  @Get('orgs')
  orgs() {
    return this.customer.listOrgs();
  }

  @Public()
  @Post('signup/request-otp')
  signupRequestOtp(@Body() dto: CustomerSignupDto) {
    return this.auth.requestSignupOtp(dto.tenantSlug, dto.nationalCode, dto.phone);
  }

  @Public()
  @Post('signup/verify-otp')
  signupVerifyOtp(@Body() dto: CustomerSignupVerifyDto) {
    return this.auth.verifySignupOtp(dto);
  }

  // ── Org-side بیمه‌گزار onboarding + approvals (org token + customer:manage) ──
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post('accounts')
  createAccount(@Body() dto: CreateCustomerDto) {
    return this.customer.createAccount(dto);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get('accounts')
  listAccounts(@Query('status') status?: string) {
    const s = status && (['PENDING', 'ACTIVE', 'REJECTED'] as const).includes(status as any) ? (status as CustomerSignupStatus) : undefined;
    return this.customer.listAccounts(s);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Get('accounts/pending-count')
  pendingCount() {
    return this.customer.pendingCount();
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post('accounts/:id/approve')
  approve(@Param('id') id: string) {
    return this.customer.approve(id);
  }

  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post('accounts/:id/reject')
  reject(@Param('id') id: string) {
    return this.customer.reject(id);
  }

  /** Customer dashboard — the caller's own cases only (requires a `customer` token). */
  @UseGuards(JwtAuthGuard)
  @Get('cases')
  myCases() {
    return this.customer.myCases();
  }

  // ── بیمه‌گزار claim self-service (ownership enforced inside ClaimsService) ──
  @UseGuards(JwtAuthGuard)
  @Get('insurers')
  insurers() {
    return this.claims.listInsurers();
  }

  /** A بیمه‌گزار files their own claim. channel=BROKER, معرف + policyHolder derived from the session. */
  @UseGuards(JwtAuthGuard)
  @Post('claims')
  fileClaim(@Body() dto: CustomerFileClaimDto) {
    return this.claims.file({
      insurerTenantId: dto.insurerTenantId,
      channel: 'BROKER' as any,
      claimType: dto.claimType,
      eventDate: dto.eventDate,
      description: dto.description,
      deceasedFullName: dto.deceasedFullName,
      deceasedNationalCode: dto.deceasedNationalCode,
    });
  }

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

  @UseGuards(JwtAuthGuard)
  @Get('claims/:id/documents/:docId/file')
  async claimDoc(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.claims.getDocumentFile(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }
}
