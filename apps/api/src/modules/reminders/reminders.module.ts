import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [AuthModule, NotificationsModule], // SmsService + in-panel notifications
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
