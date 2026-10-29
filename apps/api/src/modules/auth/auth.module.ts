import { MfaService } from './mfa.service';
import { ShahkarService } from './shahkar.service';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsService } from './sms.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SmsService, ShahkarService, MfaService],
  exports: [SmsService, ShahkarService, MfaService], // consumed by InquiryModule / CustomerModule / PlatformModule
})
export class AuthModule {}
