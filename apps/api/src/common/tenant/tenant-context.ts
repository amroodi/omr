import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  tenantId?: string;
  actorType: 'ORG_USER' | 'SUPER_ADMIN' | 'INSURED' | 'CUSTOMER' | 'SYSTEM' | 'API';
  actorId?: string;
  permissions: string[];
  ip?: string;
  userAgent?: string;
  /** For the public inquiry: the single case id a record-token is scoped to. */
  scopedCaseId?: string;
  /** For the customer realm: the customer's blind-index key to match their own cases. */
  customerNidHash?: string;
  /** Org user's branch, when branch-bound. */
  branchId?: string;
  /** When true, org queries must be restricted to `branchId` (branch admin / staff). */
  branchScoped?: boolean;
  /** Scopes granted to the current server-to-server API key (actorType 'API'). */
  apiScopes?: string[];
}

/**
 * Per-request context propagated via AsyncLocalStorage, so the Prisma extension can enforce
 * tenant isolation without threading tenantId through every call.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getTenantIdOrThrow(): string {
  const ctx = requestContext.getStore();
  if (!ctx?.tenantId) {
    throw new Error('No tenant in request context — TenantGuard must run before data access.');
  }
  return ctx.tenantId;
}
