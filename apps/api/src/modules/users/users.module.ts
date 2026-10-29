import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // MfaService (two-step login reset)
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
