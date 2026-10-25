import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PERMISSIONS, Permission } from '../../common/rbac/permissions';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

const ALL_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

/**
 * Admin roles (they manage users or roles) are preview-only, so nobody changes or removes the
 * organization's admin permissions by mistake. Every other role — built-in or custom — is editable.
 */
export const isLockedRole = (r: { permissions: string[] }) =>
  r.permissions.includes(PERMISSIONS.ROLE_MANAGE) || r.permissions.includes(PERMISSIONS.USER_MANAGE);

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Full permission catalog for the admin UI to render toggles. */
  catalog(): { key: Permission }[] {
    return Object.values(PERMISSIONS).map((key) => ({ key }));
  }

  async list() {
    const roles = await this.prisma.scoped.role.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, permissions: true, isSystem: true, _count: { select: { orgUsers: true } } } as any,
    });
    return (roles as any[]).map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, isSystem: r.isSystem, locked: isLockedRole(r), users: r._count?.orgUsers ?? 0 }));
  }

  async create(name: string, permissions: string[]) {
    this.validatePermissions(permissions);
    return this.prisma.scoped.role
      .create({ data: { tenantId: getTenantIdOrThrow(), name: name.trim(), permissions } })
      .then(async (r) => {
        await this.audit.record({ action: AuditAction.CREATE, targetType: 'Role', targetId: r.id, metadata: { name, permissions } });
        return r;
      });
  }

  async update(id: string, data: { name?: string; permissions?: string[] }) {
    const role = await this.prisma.scoped.role.findFirst({ where: { id } });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    if (isLockedRole(role)) throw new ForbiddenException('نقش‌های مدیریتی فقط قابل مشاهده‌اند و تغییر نمی‌کنند');
    if (data.permissions) {
      this.validatePermissions(data.permissions);
      if (isLockedRole({ permissions: data.permissions })) throw new BadRequestException('مجوز مدیریت کاربران یا نقش‌ها را نمی‌توان به این نقش داد');
    }

    const updated = await this.prisma.scoped.role.update({
      where: { id },
      data: { ...(data.name ? { name: data.name.trim() } : {}), ...(data.permissions ? { permissions: data.permissions } : {}) },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'Role', targetId: id, metadata: { before: { name: role.name, permissions: role.permissions }, after: data } });
    return updated;
  }

  async remove(id: string) {
    const role = await this.prisma.scoped.role.findFirst({ where: { id }, include: { _count: { select: { orgUsers: true } } } as any });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    if (isLockedRole(role)) throw new ForbiddenException('نقش‌های مدیریتی قابل حذف نیستند');
    if ((role as any)._count?.orgUsers > 0) {
      throw new BadRequestException('ابتدا کاربران این نقش را به نقش دیگری منتقل کنید');
    }
    await this.prisma.scoped.role.delete({ where: { id } });
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'Role', targetId: id, metadata: { name: role.name, permissions: role.permissions } });
    return { ok: true };
  }

  /**
   * Reject unknown permissions, the platform-only tenant:manage, and — critically — any
   * permission the caller does not themselves hold (prevents privilege escalation).
   */
  private validatePermissions(permissions: string[]): void {
    const held = new Set(getContext()?.permissions ?? []);
    for (const p of permissions) {
      if (!ALL_PERMISSIONS.has(p)) throw new BadRequestException(`مجوز نامعتبر: ${p}`);
      if (p === PERMISSIONS.TENANT_MANAGE) {
        throw new ForbiddenException('مجوز مدیریت سکو فقط برای مدیر ارشد است');
      }
      if (!held.has(p)) {
        throw new ForbiddenException(`نمی‌توانید مجوزی را که خود ندارید اعطا کنید: ${p}`);
      }
    }
  }
}
