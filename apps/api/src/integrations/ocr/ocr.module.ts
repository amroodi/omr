import { Global, Module } from '@nestjs/common';
import { OcrService } from './ocr.service';

@Global()
@Module({
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
