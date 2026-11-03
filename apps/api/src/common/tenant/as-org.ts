import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../rbac/permissions';
import { getContext, requestContext } from './tenant-context';

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as string[];

/**
 * Super Admin acting directly inside one organization (Super Admin › «کاربران پنل‌ها»): the call runs with
 * that organization as the request's tenant and every permission, so the organization's own services —
 * their scoping, checks and audit — apply unchanged. The audit records the Super Admin as the actor.
 * `kind` narrows it to brokerages or insurers when a feature exists for only one of them.
 */
export async function asOrg<T>(prisma: PrismaService, tenantId: string, fn: () => Promise<T>, kind?: 'BROKER' | 'INSURER'): Promise<T> {
  const ctx = getContext();
  if (ctx?.actorType !== 'SUPER_ADMIN') throw new ForbiddenException('دسترسی ندارید');
  const t = await prisma.unscoped().tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
  if (!t || (t.kind !== 'BROKER' && t.kind !== 'INSURER') || (kind && t.kind !== kind)) throw new NotFoundException('سازمان یافت نشد');
  return requestContext.run({ ...ctx, tenantId, permissions: ALL_PERMISSIONS, branchId: undefined, branchScoped: false }, fn);
}
