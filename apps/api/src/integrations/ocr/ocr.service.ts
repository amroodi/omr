import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentKind } from '@prisma/client';

export interface OcrResult {
  text: string;
  /** Auto-populated candidate fields, e.g. { nationalCode, fullName, policyNumber }. */
  fields: Record<string, string>;
  engine: string;
}

/**
 * OCR extraction behind a driver interface. The `stub` driver (default) returns an empty,
 * clearly-marked result so the upload/verify pipeline is testable without an OCR engine.
 *
 * To wire a real engine: add a driver branch in extract() keyed on OCR_DRIVER — e.g. Tesseract
 * (tesseract.js) for on-prem, or a cloud OCR API. Persian OCR benefits from a model trained on
 * Farsi script; keep that behind this interface so call sites are unaffected.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly driver: string;

  constructor(private readonly config: ConfigService) {
    this.driver = this.config.get<string>('OCR_DRIVER', 'stub');
  }

  async extract(buffer: Buffer, mimeType: string, kind: DocumentKind): Promise<OcrResult> {
    switch (this.driver) {
      case 'stub':
        this.logger.debug(`OCR stub invoked for ${kind} (${mimeType}, ${buffer.length} bytes)`);
        return {
          engine: 'stub',
          text: '',
          fields: {},
        };
      // case 'tesseract': return this.tesseract(buffer, mimeType, kind);
      default:
        throw new Error(`OCR driver "${this.driver}" not implemented`);
    }
  }
}
