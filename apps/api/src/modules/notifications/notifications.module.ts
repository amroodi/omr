import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule], // SmsService
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService], // used by claims + customer modules to emit notifications
})
export class NotificationsModule {}
