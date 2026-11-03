import { Global, Module } from '@nestjs/common';
import { CoverageService } from './coverage.service';
import { ModelStore } from './model-store.service';
import { ModelViewController } from './model-view.controller';
import { KindsService } from './kinds.service';
import { KindsAdminController, KindsPublicController } from './kinds.controller';

/** Global: stage names, rules and the نوع بیمه‌نامه catalog are read across claims, inquiry and claim-fields. */
@Global()
@Module({
  controllers: [ModelViewController, KindsAdminController, KindsPublicController],
  providers: [ModelStore, CoverageService, KindsService],
  exports: [ModelStore, CoverageService, KindsService],
})
export class ModelViewModule {}
