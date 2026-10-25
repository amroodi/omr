import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { getContext } from '../tenant/tenant-context';
import { AuditService } from './audit.service';

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Catch-all audit: every change request leaves a trace for the Super Admin. Handlers that already
 * write their own, more descriptive audit row (claims, users, roles, logins…) are left as they are;
 * any other successful change gets a generic row (who, which route, which fields — never the values).
 * Refused attempts (401/403) on changes are recorded too.
 */
@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!req || !CHANGES.has(req.method)) return next.handle();
    const route = `${req.method} ${req.baseUrl ?? ''}${req.route?.path ?? req.path ?? ''}`;
    const fields = req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 40) : [];
    const action = req.method === 'DELETE' ? AuditAction.DELETE : req.method === 'POST' ? AuditAction.CREATE : AuditAction.EDIT;
    const write = (status: number, refused: boolean) =>
      this.audit.record({
        action,
        targetType: 'Request',
        targetId: typeof req.params?.id === 'string' ? req.params.id : undefined,
        metadata: { route, status, fields, ...(refused ? { refused: true } : {}) },
      });
    return next.handle().pipe(
      tap({
        next: () => { if (!getContext()?.audited) void write(200, false); },
        error: (e: any) => { const st = e?.status ?? e?.getStatus?.() ?? 500; if (st === 401 || st === 403) void write(st, true); },
      }),
    );
  }
}
