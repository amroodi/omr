import { Module } from '@nestjs/common';
import { PolicyholdersController } from './policyholders.controller';
import { PolicyholdersService } from './policyholders.service';

@Module({
  controllers: [PolicyholdersController],
  providers: [PolicyholdersService],
  exports: [PolicyholdersService],
})
export class PolicyholdersModule {}
