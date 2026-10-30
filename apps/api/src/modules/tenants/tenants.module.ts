import { BrandingModule } from '../branding/branding.module';
import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [BrandingModule], // «طراحی ظاهر» of any organization
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
