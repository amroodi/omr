import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ReceiptSmsService } from './receipt-sms.service';

@Module({
  imports: [AuthModule], // SmsService
  controllers: [NotificationsController],
  providers: [NotificationsService, ReceiptSmsService],
  exports: [NotificationsService, ReceiptSmsService], // used by claims + customer modules to emit notifications; platform for «پیامک کد پذیرش»
})
export class NotificationsModule {}
