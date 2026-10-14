import { Transform } from 'class-transformer';
import { toAsciiDigits } from '../jalali/jalali.util';

/**
 * Normalizes Persian/Arabic digits to ASCII on a string DTO field. Runs during the global
 * ValidationPipe's transform phase (transform: true), i.e. BEFORE @Matches/@Length — so a phone or
 * National ID typed with ۰۱۲۳ passes the ASCII-only regexes and reaches the service already ASCII.
 */
export const ToAsciiDigits = () =>
  Transform(({ value }) => (typeof value === 'string' ? toAsciiDigits(value).trim() : value));
