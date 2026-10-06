import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClaimsModule } from '../claims/claims.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [AuthModule, ClaimsModule, NotificationsModule], // SmsService + ClaimsService + notifications
  controllers: [CustomerController],
  providers: [CustomerAuthService, CustomerService],
})
export class CustomerModule {}
