import { ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';
import { toAsciiDigits } from '../jalali/jalali.util';

// Body fields where users commonly type Persian/Arabic digits.
const DIGIT_FIELDS = ['phone', 'nationalCode', 'deceasedNationalCode', 'code', 'signupCode'];

/**
 * ValidationPipe that first normalizes Persian/Arabic digits to ASCII on known numeric fields,
 * THEN validates — so a phone / National ID / OTP typed with ۰۱۲۳ passes the ASCII-only regexes
 * and reaches the service already ASCII. This runs reliably inside the pipe (unlike @Transform or
 * body-mutating middleware, whose ordering relative to validation is environment-dependent).
 */
@Injectable()
export class NormalizingValidationPipe extends ValidationPipe {
  async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of DIGIT_FIELDS) {
        if (typeof value[k] === 'string') value[k] = toAsciiDigits(value[k]).trim();
      }
    }
    return super.transform(value, metadata);
  }
}
