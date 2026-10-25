import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClaimFieldsModule } from '../claim-fields/claim-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PolicyholdersModule } from '../policyholders/policyholders.module';
import { InquiryController } from './inquiry.controller';
import { InquiryService } from './inquiry.service';

@Module({
  imports: [AuthModule, PolicyholdersModule, NotificationsModule, ClaimFieldsModule], // SmsService, company contact, «پاسخگوی آنلاین» notices
  controllers: [InquiryController],
  providers: [InquiryService],
})
export class InquiryModule {}
