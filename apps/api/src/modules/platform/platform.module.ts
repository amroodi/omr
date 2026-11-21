import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule, NotificationsModule], // SmsService (build/test platform gateway); «پیامک کد پذیرش»
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
