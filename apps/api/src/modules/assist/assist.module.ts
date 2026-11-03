import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { AssistController } from './assist.controller';
import { AssistService } from './assist.service';

@Module({
  imports: [AuthModule, CustomerModule], // MfaService + the بیمه‌گزار company account
  controllers: [AssistController],
  providers: [AssistService],
})
export class AssistModule {}
