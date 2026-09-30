import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SmsService } from './sms.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SmsService],
  exports: [SmsService], // consumed by InquiryModule
})
export class AuthModule {}
