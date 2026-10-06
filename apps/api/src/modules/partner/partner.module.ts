import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  imports: [ApiKeysModule], // ApiKeyGuard depends on ApiKeysService
  controllers: [PartnerController],
  providers: [PartnerService],
})
export class PartnerModule {}
