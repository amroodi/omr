import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

interface CreateInput {
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  branchId?: string;
}
interface UpdateInput {
  displayName?: string;
  roleId?: string;
  branchId?: string | null;
  isActive?: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.scoped.orgUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        lastLoginAt: true,
        role: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });
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
        displayName: input.displayName.trim(),
        passwordHash: await this.hash.hashPassword(input.password),
        roleId: input.roleId,
        branchId: input.branchId ?? null,
      },
      select: { id: true, username: true, displayName: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'OrgUser', targetId: user.id, metadata: { username: input.username } });
    return user;
  }

  async update(id: string, input: UpdateInput) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (input.roleId) await this.assertRoleAssignable(input.roleId);
    if (input.branchId) await this.assertBranch(input.branchId);

    const updated = await this.prisma.scoped.orgUser.update({
      where: { id },
      data: {
        ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, username: true, displayName: true, isActive: true },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'OrgUser', targetId: id, metadata: input as Record<string, unknown> });
    return updated;
  }

  async resetPassword(id: string, password: string) {
    const user = await this.prisma.scoped.orgUser.findFirst({ where: { id } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.scoped.orgUser.update({ where: { id }, data: { passwordHash: await this.hash.hashPassword(password) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'OrgUser', targetId: id, metadata: { passwordReset: true } });
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
