import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContext, RequestContext } from './tenant-context';
import { toAsciiDigits } from '../jalali/jalali.util';

// Numeric body fields where users commonly type Persian/Arabic digits (phone, National ID, OTP).
// Normalized to ASCII here — before the ValidationPipe — so the ASCII-only regexes accept them.
const DIGIT_FIELDS = ['phone', 'nationalCode', 'deceasedNationalCode', 'code', 'signupCode'];

/**
 * Establishes the AsyncLocalStorage store for each request and runs the rest of the pipeline
 * inside it. Guards later mutate this same store object (auth, tenant, permissions), and the
 * Prisma extension reads it. Runs before guards. Also normalizes Persian/Arabic digits to ASCII
 * on known numeric body fields (runs before validation).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const body = (req as any).body;
    if (body && typeof body === 'object') {
      for (const k of DIGIT_FIELDS) {
        if (typeof body[k] === 'string') body[k] = toAsciiDigits(body[k]).trim();
      }
    }
    const store: RequestContext = {
      actorType: 'SYSTEM',
      permissions: [],
      // req.ip is derived by Express from X-Forwarded-For using the configured `trust proxy` hop
      // count (set in main.ts), so it is the real client IP and not a client-spoofable header value.
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    };
    (req as any).context = store;
    requestContext.run(store, () => next());
  }
}
