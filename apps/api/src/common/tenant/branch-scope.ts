import { getContext } from './tenant-context';

/**
 * Returns a Prisma where-fragment enforcing branch scoping for the current org user. Branch-bound
 * users (no org-wide `branch:manage`) are restricted to their own branch; everyone else sees all
 * branches. Spread into a `where` on branch-owned models (e.g. Case).
 */
export function branchWhere(): { branchId?: string } {
  const ctx = getContext();
  if (ctx?.branchScoped && ctx.branchId) return { branchId: ctx.branchId };
  return {};
}
