import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
