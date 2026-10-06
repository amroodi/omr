import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

@Module({
  imports: [AuthModule], // for SmsService (per-tenant gateway config + test send)
  controllers: [BrandingController],
  providers: [BrandingService],
})
export class BrandingModule {}
