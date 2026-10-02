import { Module } from '@nestjs/common';
import { RequiredDocsController } from './required-docs.controller';
import { RequiredDocsService } from './required-docs.service';

@Module({
  controllers: [RequiredDocsController],
  providers: [RequiredDocsService],
})
export class RequiredDocsModule {}
