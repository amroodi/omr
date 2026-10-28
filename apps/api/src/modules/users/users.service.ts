import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

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
  ) {}

  async list() {
    const rows = await this.prisma.scoped.orgUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        lastLoginAt: true,
        role: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        desk: true,
        phone: true,
      },
    });
    return rows.map((r) => ({ ...r, phone: r.phone ? this.crypto.decrypt(r.phone) : null }));
  }

  async create(input: CreateInput) {
    await this.assertRoleAssignable(input.roleId);
    if (input.branchId) await this.assertBranch(input.branchId);

    const exists = await this.prisma.scoped.orgUser.findFirst({ where: { username: input.username } });
    if (exists) throw new BadRequestException('این نام کاربری قبلاً ثبت شده است');

    const user = await this.prisma.scoped.orgUser.create({
      data: {
        tenantId: getTenantIdOrThrow(),
        username: input.username.trim(),
        displayName: input.displayName?.trim() || input.username.trim(),
        passwordHash: await this.hash.hashPassword(input.password),
        roleId: input.roleId,
        branchId: input.branchId ?? null,
        desk: input.branchId ? null : (input.desk ?? null),
        phone: input.phone ? this.crypto.encrypt(input.phone.trim()) : null,
      },
      select: { id: true, username: true, displayName: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'OrgUser', targetId: user.id, metadata: { username: input.username } });
    return user;
  }

  async update(id: string, input: UpdateInput) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id }, include: { role: { select: { name: true } } } });
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
    return updated;
  }

  /** Users are never deleted (their actions stay attributable); deactivate them instead. */
  async remove(_id: string): Promise<never> {
    throw new ForbiddenException('کاربران حذف نمی‌شوند تا سوابق اقدامات آن‌ها حفظ شود؛ به‌جای حذف، کاربر را غیرفعال کنید.');
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.scoped.orgUser.update({ where: { id }, data: { passwordHash: await this.hash.hashPassword(password) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'OrgUser', targetId: id, metadata: { username: user.username, passwordReset: true } });
    return { ok: true };
  }

  /** A caller may not assign a role granting permissions they themselves lack (no escalation). */
  private async assertRoleAssignable(roleId: string): Promise<void> {
    const role = await this.prisma.scoped.role.findFirst({ where: { id: roleId }, select: { permissions: true } });
    if (!role) throw new BadRequestException('نقش نامعتبر است');
    const held = new Set(getContext()?.permissions ?? []);
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
