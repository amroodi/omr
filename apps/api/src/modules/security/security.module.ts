import { Global, Module } from '@nestjs/common';
import { SmsService } from '../auth/sms.service';
import { SecurityAdminController, SecurityController } from './security.controller';
import { SessionsService } from './sessions.service';

/**
 * «امنیت ورود». Global so every sign-in (org, Super Admin, بیمه‌گزار) and the auth guard can reach the
 * sessions service. Its own SmsService instance (only global deps), so it doesn't import AuthModule —
 * AuthModule depends on this one.
 */
@Global()
@Module({
  controllers: [SecurityController, SecurityAdminController],
  providers: [SessionsService, SmsService],
  exports: [SessionsService],
})
export class SecurityModule {}
