import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ENTRY_PERMISSIONS, PERMISSIONS } from '../../common/rbac/permissions';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { SessionsService } from '../security/sessions.service';

interface CreateInput {
  username: string;
  displayName?: string;
  password: string;
  roleId: string;
  branchId?: string;
  desk?: 'HQ' | 'COUNCIL';
  phone?: string;
}
interface UpdateInput {
  phone?: string;
  displayName?: string;
  roleId?: string;
  branchId?: string | null;
  isActive?: boolean;
  desk?: 'HQ' | 'COUNCIL' | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly audit: AuditService,
    private readonly crypto: FieldCryptoService,
    private readonly sessions: SessionsService,
  ) {}

  async list() {
    const rows = await this.prisma.scoped.orgUser.findMany({
      where: { removedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        lastLoginAt: true,
        role: { select: { id: true, name: true, permissions: true } },
        branch: { select: { id: true, name: true } },
        desk: true,
        phone: true,
        totpSecret: true,
      },
    });
    return rows.map(({ totpSecret, role, ...r }) => ({
      ...r,
      role: role ? { id: role.id, name: role.name } : null,
      // Panel 1 «ورود برای بارگذاری مدارک» is open to roles that can create cases.
      entry: (role?.permissions ?? []).some((p) => ENTRY_PERMISSIONS.includes(p)),
      phone: r.phone ? this.crypto.decrypt(r.phone) : null,
      mfaEnabled: !!totpSecret,
    }));
  }

  async create(input: CreateInput) {
    await this.assertRoleAssignable(input.roleId);
    if (input.branchId) await this.assertBranch(input.branchId);

    const username = input.username.trim();
    const exists = await this.prisma.scoped.orgUser.findFirst({ where: { username } });
    if (exists && !exists.removedAt) throw new BadRequestException('این نام کاربری قبلاً ثبت شده است');
    // A removed user keeps their record (and history) under a retired name, so the name is free again.
    if (exists) await this.prisma.scoped.orgUser.update({ where: { id: exists.id }, data: { username: `${exists.username}~${exists.id.slice(0, 8)}` } });

    const user = await this.prisma.scoped.orgUser.create({
      data: {
        tenantId: getTenantIdOrThrow(),
        username,
        displayName: input.displayName?.trim() || username,
        passwordHash: await this.hash.hashPassword(input.password),
        roleId: input.roleId,
        branchId: input.branchId ?? null,
        desk: input.branchId ? null : (input.desk ?? null),
        phone: input.phone ? this.crypto.encrypt(input.phone.trim()) : null,
      },
      select: { id: true, username: true, displayName: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'OrgUser', targetId: user.id, metadata: { username } });
    return user;
  }

  async update(id: string, input: UpdateInput) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id, removedAt: null }, include: { role: { select: { name: true } } } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (getContext()?.actorId === id && input.isActive === false) throw new BadRequestException('نمی‌توانید حساب کاربری خودتان را غیرفعال کنید');
    // A user sits either at a branch or at a central desk, never both.
    if (input.branchId) input.desk = null;
    if (input.desk) input.branchId = null;
    if (input.roleId) await this.assertRoleAssignable(input.roleId);
    if (input.branchId) await this.assertBranch(input.branchId);

    const updated = await this.prisma.scoped.orgUser.update({
      where: { id },
      data: {
        ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.desk !== undefined ? { desk: input.desk } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ? this.crypto.encrypt(input.phone.trim()) : null } : {}),
      },
      select: { id: true, username: true, displayName: true, isActive: true },
    });
    // Before → after, so the Super Admin sees exactly what changed.
    await this.audit.record({
      action: AuditAction.EDIT, targetType: 'OrgUser', targetId: id,
      metadata: { username: user.username, before: { displayName: user.displayName, roleId: user.roleId, role: user.role?.name, branchId: user.branchId, desk: user.desk, isActive: user.isActive }, after: input },
    });
    // Deactivated (or moved to a role that may lose access): their open sessions end now, not at expiry.
    if ((input.isActive === false && user.isActive) || (input.roleId && input.roleId !== user.roleId)) await this.sessions.endAllOf('ORG', id);
    return updated;
  }

  /**
   * «حذف»: the user disappears from every list and can no longer sign in (open sessions end now), but the
   * record stays so the actions they took on cases remain attributable. Their username becomes free.
   */
  async remove(id: string) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id, removedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (getContext()?.actorId === id) throw new BadRequestException('نمی‌توانید حساب کاربری خودتان را حذف کنید');
    await this.prisma.scoped.orgUser.update({ where: { id }, data: { removedAt: new Date(), isActive: false } });
    await this.sessions.endAllOf('ORG', id);
    await this.audit.record({ action: AuditAction.DELETE, targetType: 'OrgUser', targetId: id, metadata: { username: user.username, displayName: user.displayName } });
    return { ok: true };
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id, removedAt: null } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.scoped.orgUser.update({ where: { id }, data: { passwordHash: await this.hash.hashPassword(password) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'OrgUser', targetId: id, metadata: { username: user.username, passwordReset: true } });
    return { ok: true };
  }

  /** Roles and branches of the organization, for the user editor (Super Admin › کاربران پنل‌ها). */
  async editorOptions() {
    const [roles, branches, tenant] = await Promise.all([
      this.prisma.scoped.role.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, permissions: true } }),
      this.prisma.scoped.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
      this.prisma.unscoped().tenant.findUnique({ where: { id: getTenantIdOrThrow() }, select: { kind: true, name: true } }),
    ]);
    return {
      kind: tenant?.kind ?? null,
      name: tenant?.name ?? '',
      roles: roles.map((r) => ({ id: r.id, name: r.name, entry: r.permissions.some((p) => ENTRY_PERMISSIONS.includes(p)) })),
      branches,
    };
  }

  /** A caller may not assign a role granting permissions they themselves lack (no escalation). */
  private async assertRoleAssignable(roleId: string): Promise<void> {
    const role = await this.prisma.scoped.role.findFirst({ where: { id: roleId }, select: { permissions: true } });
    if (!role) throw new BadRequestException('نقش نامعتبر است');
    const held = new Set(getContext()?.permissions ?? []);
    // «پزشک معتمد» opens only the doctor panel (no claims access): whoever manages users may give it.
    if (held.has(PERMISSIONS.USER_MANAGE)) held.add(PERMISSIONS.DOCTOR_OPINE);
    const escalating = role.permissions.filter((p) => !held.has(p));
    if (escalating.length > 0) {
      throw new ForbiddenException(`نمی‌توانید نقشی با مجوزهای بالاتر از خود اختصاص دهید: ${escalating.join(', ')}`);
    }
  }

  private async assertBranch(branchId: string): Promise<void> {
    const branch = await this.prisma.scoped.branch.findFirst({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw new BadRequestException('شعبه نامعتبر است');
  }
}
