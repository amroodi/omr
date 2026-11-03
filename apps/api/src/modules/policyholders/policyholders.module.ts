import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PolicyholdersAdminController } from './policyholders-admin.controller';
import { PolicyholdersAdminService } from './policyholders-admin.service';
import { PolicyholdersController } from './policyholders.controller';
import { PolicyholdersManageController, PolicyholdersOperatorsController } from './policyholders-manage.controller';
import { PolicyholdersService } from './policyholders.service';

@Module({
  imports: [AuthModule], // SmsService — the answer to a «گفتگو» question is texted to the requester
  // The «manage» routes first, so `policyholder-companies/manage/…` is never read as a company id.
  controllers: [PolicyholdersManageController, PolicyholdersController, PolicyholdersAdminController, PolicyholdersOperatorsController],
  providers: [PolicyholdersService, PolicyholdersAdminService],
  exports: [PolicyholdersService],
})
export class PolicyholdersModule {}
