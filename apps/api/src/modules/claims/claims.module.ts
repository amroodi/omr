import { Module } from '@nestjs/common';
import { ClaimFieldsModule } from '../claim-fields/claim-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PolicyholdersModule } from '../policyholders/policyholders.module';
import { AiReviewModule } from '../ai-review/ai-review.module';
import { UploadLinkController } from './upload-link.controller';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { ImportedClaimsAdminController } from './imported-claims-admin.controller';

@Module({
  imports: [ClaimFieldsModule, NotificationsModule, PolicyholdersModule, AiReviewModule],
  controllers: [ClaimsController, ImportedClaimsAdminController, UploadLinkController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
