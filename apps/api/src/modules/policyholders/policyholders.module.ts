import { Module } from '@nestjs/common';
import { PolicyholdersAdminController } from './policyholders-admin.controller';
import { PolicyholdersAdminService } from './policyholders-admin.service';
import { PolicyholdersController } from './policyholders.controller';
import { PolicyholdersService } from './policyholders.service';

@Module({
  controllers: [PolicyholdersController, PolicyholdersAdminController],
  providers: [PolicyholdersService, PolicyholdersAdminService],
  exports: [PolicyholdersService],
})
export class PolicyholdersModule {}
