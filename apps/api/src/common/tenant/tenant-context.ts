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
  /** For the public inquiry: the single (new-model) claim id a record-token is scoped to. */
  scopedClaimId?: string;
  /** For the public inquiry: the requester's OTP-verified phone (encrypted), for «پاسخگوی آنلاین». */
  scopedPhone?: string;
  /** For the customer realm: the customer's blind-index key to match their own cases. */
  customerNidHash?: string;
  /** For the customer realm, company login (کد بیمه‌گزار + password): the بیمه‌گزار company. */
  customerCompanyId?: string;
  /** For the customer realm, the brokerage's own «broker» login: acts for every بیمه‌گزار of the brokerage. */
  customerBrokerPanel?: boolean;
  /** Org user's branch, when branch-bound. */
  branchId?: string;
  /** When true, org queries must be restricted to `branchId` (branch admin / staff). */
  branchScoped?: boolean;
  /** Scopes granted to the current server-to-server API key (actorType 'API'). */
  apiScopes?: string[];
  /** Set once the request has written its own audit row (the catch-all audit then stays quiet). */
  audited?: boolean;
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

/**
 * Is this claim the calling بیمه‌گزار's own? Filed by them — or, for a company login, filed for their
 * company (including claims the brokerage filed on the company's behalf).
 */
export function customerOwnsClaim(claim: { policyHolderId?: string | null; policyholderCompanyId?: string | null; brokerTenantId?: string | null }): boolean {
  const ctx = getContext();
  if (ctx?.actorType !== 'CUSTOMER' || !ctx.actorId) return false;
  if (ctx.customerBrokerPanel) return !!ctx.tenantId && claim.brokerTenantId === ctx.tenantId;
  if (claim.policyHolderId === ctx.actorId) return true;
  return !!ctx.customerCompanyId && claim.policyholderCompanyId === ctx.customerCompanyId;
}

/** Prisma filter for the calling بیمه‌گزار's own claims (see customerOwnsClaim). */
export function customerClaimWhere(): { OR: ({ policyHolderId: string } | { policyholderCompanyId: string } | { brokerTenantId: string })[] } {
  const ctx = getContext();
  if (ctx?.customerBrokerPanel) return { OR: [{ brokerTenantId: ctx.tenantId ?? '__none__' }] };
  const or: ({ policyHolderId: string } | { policyholderCompanyId: string })[] = [{ policyHolderId: ctx?.actorId ?? '__none__' }];
  if (ctx?.customerCompanyId) or.push({ policyholderCompanyId: ctx.customerCompanyId });
  return { OR: or };
}
