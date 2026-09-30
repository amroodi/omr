import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [AuthModule], // for SmsService
  controllers: [CustomerController],
  providers: [CustomerAuthService, CustomerService],
})
export class CustomerModule {}
