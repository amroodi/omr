import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SYSTEM_ROLES } from '../../common/rbac/permissions';
import { getContext } from '../../common/tenant/tenant-context';
import { DEFAULT_REQUIRED_DOCS } from '../required-docs/defaults';
import { DEFAULT_CLAIM_FIELDS } from '../claim-fields/defaults';

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
        kind: true,
        isActive: true,
        licenseUntil: true,
        createdAt: true,
        _count: { select: { orgUsers: true, cases: true, customers: true } },
      },
    });
  }

  /** Platform-only: edit an organization's name / type / slug. */
  async update(id: string, input: { name?: string; kind?: 'INSURER' | 'BROKER'; slug?: string }) {
    const db = this.prisma.unscoped();
    const current = await db.tenant.findUnique({ where: { id }, select: { kind: true } });
    if (!current) throw new BadRequestException('سازمان یافت نشد');
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.slug !== undefined) {
      const slug = input.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new BadRequestException('شناسه سازمان باید انگلیسی، کوچک و بدون فاصله باشد');
      const clash = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (clash && clash.id !== id) throw new BadRequestException('این شناسه سازمان قبلاً استفاده شده است');
      data.slug = slug;
    }
    if (Object.keys(data).length === 0) return { ok: true };

    const t = await db.tenant.update({ where: { id }, data });

    // Converting to INSURER: seed the default catalogs if this tenant has none yet.
    if (input.kind === 'INSURER' && current.kind !== 'INSURER') {
      const has = await db.requiredDocument.count({ where: { tenantId: id } });
      if (has === 0) {
        await db.requiredDocument.createMany({ data: DEFAULT_REQUIRED_DOCS.map((d) => ({ ...d, tenantId: id })) });
        await db.claimFieldDef.createMany({
          data: DEFAULT_CLAIM_FIELDS.map((d) => ({ tenantId: id, key: d.key, label: d.label, type: d.type, group: d.group, options: d.options ?? [], editableBy: d.editableBy, order: d.order, required: d.required ?? false })),
        });
      }
    }
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', actorId: getContext()?.actorId, tenantId: id, targetType: 'Tenant', targetId: id, metadata: data });
    return { id: t.id, slug: t.slug, name: t.name, kind: t.kind };
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

      // An insurer starts with the default required-document and claim-field catalogs.
      if (tenant.kind === 'INSURER') {
        await tx.requiredDocument.createMany({
          data: DEFAULT_REQUIRED_DOCS.map((d) => ({ ...d, tenantId: tenant.id })),
        });
        await tx.claimFieldDef.createMany({
          data: DEFAULT_CLAIM_FIELDS.map((d) => ({
            tenantId: tenant.id,
            key: d.key,
            label: d.label,
            type: d.type,
            group: d.group,
            options: d.options ?? [],
            editableBy: d.editableBy,
            order: d.order,
            required: d.required ?? false,
          })),
        });
      }

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

  /** Platform-only: reset an organization's admin password, returning a one-time password. */
  async resetAdminPassword(tenantId: string, username = 'admin') {
    const db = this.prisma.unscoped();
    const user = await db.orgUser.findUnique({ where: { tenantId_username: { tenantId, username: username.trim() } } });
    if (!user) throw new BadRequestException('کاربر مدیر با این نام کاربری یافت نشد');
    const password = randomBytes(9).toString('base64url');
    await db.orgUser.update({ where: { id: user.id }, data: { passwordHash: await this.hash.hashPassword(password) } });
    await this.audit.record({
      action: AuditAction.EDIT,
      actorType: 'SUPER_ADMIN',
      actorId: getContext()?.actorId,
      tenantId,
      targetType: 'OrgUser',
      targetId: user.id,
      metadata: { action: 'admin-password-reset', username },
    });
    return { username: user.username, oneTimePassword: password };
  }

  async setActive(id: string, isActive: boolean) {
    const tenant = await this.prisma.unscoped().tenant.update({ where: { id }, data: { isActive } });
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', tenantId: id, targetType: 'Tenant', targetId: id, metadata: { isActive } });
    return { id: tenant.id, isActive: tenant.isActive };
  }
}
