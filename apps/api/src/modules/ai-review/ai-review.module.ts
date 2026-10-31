import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiReviewController } from './ai-review.controller';
import { AiReviewQueue } from './ai-review.queue';
import { AiReviewSettings } from './ai-review.settings';
import { AvalaiClient } from './avalai.client';

@Module({
  imports: [AuthModule], // SmsService (result SMS)
  controllers: [AiReviewController],
  providers: [AvalaiClient, AiReviewSettings, AiReviewQueue],
  exports: [AiReviewSettings, AiReviewQueue],
})
export class AiReviewModule {}
