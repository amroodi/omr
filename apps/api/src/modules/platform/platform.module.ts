import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AuthModule], // SmsService (build/test platform gateway)
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
