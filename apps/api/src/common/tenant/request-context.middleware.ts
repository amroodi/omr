import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { requestContext, RequestContext } from './tenant-context';

/**
 * Establishes the AsyncLocalStorage store for each request and runs the rest of the pipeline
 * inside it. Guards later mutate this same store object (auth, tenant, permissions), and the
 * Prisma extension reads it. Runs before guards.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const store: RequestContext = {
      actorType: 'SYSTEM',
      permissions: [],
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    };
    (req as any).context = store;
    requestContext.run(store, () => next());
  }
}
