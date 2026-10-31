import {
  Body,
  Controller,
  Get,
  Param,
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
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permissions, Public } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { ToAsciiDigits } from '../../common/validation/to-ascii.decorator';

class CreateCustomerDto {
  @ToAsciiDigits() @IsString() @Length(8, 12) nationalCode!: string;
  @ToAsciiDigits() @IsString() @Matches(/^0?9\d{9}$/) phone!: string;
  @IsOptional() @IsString() @Length(2, 120) fullName?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  // نماینده's password; empty = their کد ملی (changed on first login).
  @IsOptional() @IsString() @Length(0, 200) password?: string;
}

class AccountPasswordDto {
  @IsOptional() @IsString() @Length(0, 200) password?: string;
}
import { CustomerSignupStatus } from '@prisma/client';
import { ClaimsService } from '../claims/claims.service';
import { HeirsDto, PhysicalDto } from '../claims/dto';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerService } from './customer.service';
import { RepresentativeLoginDto, CustomerChangePasswordDto, CustomerCompanyLoginDto, CustomerFileClaimDto, CustomerRequestOtpDto, CustomerSignupDto, CustomerSignupVerifyDto, CustomerVerifyOtpDto } from './dto';

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly customer: CustomerService,
    private readonly claims: ClaimsService,
  ) {}

  /** بیمه‌گزار panel login: کد بیمه‌گزار + password (one login per company). */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('login/company')
  companyLogin(@Body() dto: CustomerCompanyLoginDto) {
    return this.auth.companyLogin(dto.code, dto.password);
  }

  /** نماینده panel login: کد ملی + password. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('login/representative')
  representativeLogin(@Body() dto: RepresentativeLoginDto) {
    return this.auth.representativeLoginPublic(dto.nationalCode, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  changePassword(@Body() dto: CustomerChangePasswordDto) {
    return this.auth.changeCompanyPassword(dto.current, dto.next);
  }

  /** «داشبورد»: the company's policies (عمر / حوادث, every year) and the totals of one of them. */
  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  dashboard(@Query('contractId') contractId?: string, @Query('companyId') companyId?: string) {
    return this.customer.dashboard(contractId, companyId);
  }

  /** «broker» login: the brokerage's بیمه‌گزار companies. */
  @UseGuards(JwtAuthGuard)
  @Get('broker/companies')
  brokerCompanies(@Query('q') q?: string) {
    return this.customer.brokerCompanies(q);
  }

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

  /** Direct login with no code — only works when OTP is disabled platform-wide. */
  @Public()
  @UseGuards(TenantResolverGuard)
  @Post('login/direct')
  directLogin(@Body() dto: CustomerRequestOtpDto) {
    return this.auth.directLogin(dto.nationalCode, dto.phone);
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

  /** Direct signup with no code — only works when OTP is disabled platform-wide. */
  @Public()
  @Post('signup/direct')
  signupDirect(@Body() dto: CustomerSignupDto) {
    return this.auth.directSignup(dto);
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

  /** Set a نماینده's password (empty = reset to their کد ملی). */
  @Permissions(PERMISSIONS.CUSTOMER_MANAGE)
  @Post('accounts/:id/password')
  setAccountPassword(@Param('id') id: string, @Body() dto: AccountPasswordDto) {
    return this.customer.setAccountPassword(id, dto.password);
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

  /** «اعلام خسارت»: may this login file, and to which desks? */
  @UseGuards(JwtAuthGuard)
  @Get('notice-options')
  noticeOptions() {
    return this.claims.noticeOptions();
  }

  /** A بیمه‌گزار files their own claim. channel=BROKER, معرف + policyHolder derived from the session. */
  @UseGuards(JwtAuthGuard)
  @Post('claims')
  fileClaim(@Body() dto: CustomerFileClaimDto) {
    return this.claims.file({
      channel: 'BROKER' as any,
      deceasedBirthDate: dto.deceasedBirthDate,
      claimType: dto.claimType,
      eventDate: dto.eventDate,
      description: dto.description,
      causeOfDeath: dto.causeOfDeath,
      beneficiaryType: dto.beneficiaryType,
      heirs: dto.heirs,
      startStage: dto.startStage,
      contractId: dto.contractId,
      policyholderCompanyId: dto.companyId,
      deceasedFullName: dto.deceasedFullName,
      deceasedNationalCode: dto.deceasedNationalCode,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me() {
    return this.customer.me();
  }

  @UseGuards(JwtAuthGuard)
  @Get('claims')
  myClaims(@Query('q') q?: string) {
    return this.claims.listMine(q);
  }

  @UseGuards(JwtAuthGuard)
  @Get('claims/:id')
  claim(@Param('id') id: string) {
    return this.claims.get(id);
  }

  /** «روند پرونده»: the case's executive steps (dates/statuses), read-only for the بیمه‌گزار. */
  @UseGuards(JwtAuthGuard)
  @Get('claims/:id/fields')
  claimFields(@Param('id') id: string) {
    return this.claims.fieldsReadOnly(id);
  }

  /** «ذینفع / وراث قانونی» of the case (name + شبا each). */
  @UseGuards(JwtAuthGuard)
  @Get('claims/:id/heirs')
  claimHeirs(@Param('id') id: string) {
    return this.claims.heirs(id);
  }

  /** The بیمه‌گزار corrects them while the case is on their desk. */
  @UseGuards(JwtAuthGuard)
  @Put('claims/:id/heirs')
  setClaimHeirs(@Param('id') id: string, @Body() dto: HeirsDto) {
    return this.claims.setHeirs(id, dto);
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

  /** بیمه‌گزار sends the original documents to شعبه when asked. */
  @UseGuards(JwtAuthGuard)
  @Post('claims/:id/physical')
  physical(@Param('id') id: string, @Body() dto: PhysicalDto) {
    return this.claims.physicalAct(id, dto);
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
