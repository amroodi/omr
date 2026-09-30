import { Global, Module } from '@nestjs/common';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';

// Global so future partner-facing modules can inject SharingService.assertAccess().
@Global()
@Module({
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
