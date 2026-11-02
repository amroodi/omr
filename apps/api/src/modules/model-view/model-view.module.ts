import { Global, Module } from '@nestjs/common';
import { CoverageService } from './coverage.service';
import { ModelStore } from './model-store.service';
import { ModelViewController } from './model-view.controller';

/** Global: stage names and rules are read across claims, inquiry and claim-fields. */
@Global()
@Module({
  controllers: [ModelViewController],
  providers: [ModelStore, CoverageService],
  exports: [ModelStore, CoverageService],
})
export class ModelViewModule {}
