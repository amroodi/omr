import { Module } from '@nestjs/common';
import { ClaimFieldDefsService } from './claim-field-defs.service';
import { ClaimFieldsController } from './claim-fields.controller';
import { ClaimFieldsService } from './claim-fields.service';

@Module({
  controllers: [ClaimFieldsController],
  providers: [ClaimFieldsService, ClaimFieldDefsService],
  exports: [ClaimFieldsService],
})
export class ClaimFieldsModule {}
