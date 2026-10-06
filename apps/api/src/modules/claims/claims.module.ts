import { Module } from '@nestjs/common';
import { ClaimFieldsModule } from '../claim-fields/claim-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';

@Module({
  imports: [ClaimFieldsModule, NotificationsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
