import { Module } from '@nestjs/common';
import { ImportModule } from '../import/import.module';
import { ModelViewModule } from '../model-view/model-view.module';
import { SpareController, SpareSharedController } from './spare.controller';
import { SpareService } from './spare.service';

@Module({
  imports: [ImportModule, ModelViewModule],
  controllers: [SpareController, SpareSharedController],
  providers: [SpareService],
})
export class SpareModule {}
