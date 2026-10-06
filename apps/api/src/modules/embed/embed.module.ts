import { Module } from '@nestjs/common';
import { TenantResolverGuard } from '../../common/tenant/tenant-resolver.guard';
import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';

@Module({
  controllers: [EmbedController],
  providers: [EmbedService, TenantResolverGuard],
})
export class EmbedModule {}
