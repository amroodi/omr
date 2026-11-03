import { Module } from '@nestjs/common';
import { UsersAdminController } from './users-admin.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // MfaService (two-step login reset)
  controllers: [UsersController, UsersAdminController],
  providers: [UsersService],
})
export class UsersModule {}
