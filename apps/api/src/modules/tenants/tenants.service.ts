import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SYSTEM_ROLES } from '../../common/rbac/permissions';
import { getContext } from '../../common/tenant/tenant-context';

interface ProvisionInput {
  name: string;
  slug: string;
  adminUsername: string;
  adminDisplayName?: string;
  adminPassword?: string; // generated if omitted
  primaryColor?: string;
  contactHeader?: string;
  kind?: 'INSURER' | 'BROKER';
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.unscoped().tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        licenseUntil: true,
        createdAt: true,
        _count: { select: { orgUsers: true, cases: true, customers: true } },
      },
    });
  }

  /** Provision a new organization (tenant): tenant row, system roles, and its first org admin. */
  async provision(input: ProvisionInput) {
    const db = this.prisma.unscoped();
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      throw new BadRequestException('شناسه سازمان باید انگلیسی، کوچک و بدون فاصله باشد');
    }
    if (await db.tenant.findUnique({ where: { slug } })) {
      throw new BadRequestException('این شناسه سازمان قبلاً استفاده شده است');
    }

    const password = input.adminPassword || randomBytes(9).toString('base64url');

    const result = await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: input.name.trim(),
          kind: input.kind ?? 'BROKER',
          primaryColor: input.primaryColor ?? '#ff9500',
          contactHeader: input.contactHeader ?? null,
        },
      });

      // Seed the standard roles for this tenant.
      const roleIds: Record<string, string> = {};
      for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, name, permissions, isSystem: true },
        });
        roleIds[name] = role.id;
      }

      const admin = await tx.orgUser.create({
        data: {
          tenantId: tenant.id,
          username: input.adminUsername.trim(),
          displayName: input.adminDisplayName?.trim() || input.adminUsername.trim(),
          passwordHash: await this.hash.hashPassword(password),
          roleId: roleIds['مدیر سازمان'],
        },
      });

      return { tenant, adminId: admin.id };
    });

    await this.audit.record({
      action: AuditAction.TENANT_PROVISION,
      actorType: 'SUPER_ADMIN',
      actorId: getContext()?.actorId,
      tenantId: result.tenant.id,
      targetType: 'Tenant',
      targetId: result.tenant.id,
      metadata: { slug, adminUsername: input.adminUsername },
    });

    // Password returned once to the super-admin to hand to the org; never stored in plaintext.
    return {
      tenant: { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name },
      admin: { username: input.adminUsername, oneTimePassword: password },
    };
  }

  async setActive(id: string, isActive: boolean) {
    const tenant = await this.prisma.unscoped().tenant.update({ where: { id }, data: { isActive } });
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', tenantId: id, targetType: 'Tenant', targetId: id, metadata: { isActive } });
    return { id: tenant.id, isActive: tenant.isActive };
  }
}
