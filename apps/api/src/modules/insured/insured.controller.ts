import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/rbac/decorators';
import { ClaimsService } from '../claims/claims.service';
import { InsuredService } from './insured.service';

class PhoneDto { @IsString() @Length(10, 16) phone!: string; }
class VerifyDto extends PhoneDto { @IsString() @Length(4, 10) code!: string; }
class InviteDto extends PhoneDto { @IsOptional() @IsString() @Length(0, 120) fullName?: string; }

/** «پنل بیمه‌شده»: sign-in with an SMS code on an invited mobile. A token of this kind opens only these routes. */
@Controller('insured')
export class InsuredController {
  constructor(private readonly svc: InsuredService) {}

  @Public()
  @Get('status')
  async status() {
    return { enabled: await this.svc.anyEnabled() };
  }

  @Public()
  @Post('login/request-otp')
  requestOtp(@Body() dto: PhoneDto) {
    return this.svc.requestOtp(dto.phone);
  }

  @Public()
  @Post('login/verify-otp')
  verifyOtp(@Body() dto: VerifyDto) {
    return this.svc.verifyOtp(dto.phone, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Get('cases')
  cases() {
    return this.svc.cases();
  }

  @UseGuards(JwtAuthGuard)
  @Post('cases/:id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(@Param('id', ParseUUIDPipe) id: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.upload(id, docCode, file);
  }
}

/** The بیمه‌گزار / نماینده manages who is invited onto their own case. */
@Controller('customer/claims/:id/insured-access')
export class InsuredInviteController {
  constructor(private readonly svc: InsuredService, private readonly claims: ClaimsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.claims.claimForParty(id);
    return this.svc.invites(c.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async invite(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InviteDto) {
    return this.svc.invite(await this.claims.claimForParty(id), dto.phone, dto.fullName);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':accessId')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Param('accessId', ParseUUIDPipe) accessId: string) {
    return this.svc.revoke(await this.claims.claimForParty(id), accessId);
  }
}
