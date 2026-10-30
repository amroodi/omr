import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PolicyholdersAdminController } from './policyholders-admin.controller';
import { PolicyholdersAdminService } from './policyholders-admin.service';
import { PolicyholdersController } from './policyholders.controller';
import { PolicyholdersService } from './policyholders.service';

@Module({
  imports: [AuthModule], // SmsService — the answer to a «گفتگو» question is texted to the requester
  controllers: [PolicyholdersController, PolicyholdersAdminController],
  providers: [PolicyholdersService, PolicyholdersAdminService],
  exports: [PolicyholdersService],
})
export class PolicyholdersModule {}
