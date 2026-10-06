/**
 * PRODUCTION provisioning — creates ONLY what a real deployment needs:
 *   - the organization tenant
 *   - system roles (permissions kept in sync with code)
 *   - one org admin user
 *   - one platform super-admin
 *
 * It does NOT create any sample insured/policy/claim/payment and NO development OTP.
 * It is idempotent and safe to re-run: an existing admin/super-admin KEEPS its password
 * (never reset in production); only newly-created users get a generated password.
 *
 * Run on the server (loads /etc/omr/api.env for DATABASE_URL + the required secrets):
 *   set -a; source /etc/omr/api.env; set +a
 *   SUPER_ADMIN_EMAIL=you@damuon.com npx ts-node prisma/provision.ts
 *
 * Optional overrides: PROVISION_TENANT_SLUG (default "damuon"), PROVISION_TENANT_NAME,
 * PROVISION_TENANT_KIND (BROKER|INSURER, default BROKER), PROVISION_ADMIN_USERNAME (default "admin").
 */
import { PrismaClient, TenantKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { SYSTEM_ROLES } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('REPLACE_ME')) {
    throw new Error(`${name} must be set (and not a placeholder) before provisioning.`);
  }
  return v;
}

function generatedPassword(): string {
  return randomBytes(12).toString('base64url');
}

async function main(): Promise<void> {
  // The app cannot run without these; provisioning is the moment to fail fast on placeholders.
  for (const k of ['FIELD_ENCRYPTION_KEY', 'BLIND_INDEX_PEPPER', 'JWT_SECRET']) need(k);

  const slug = process.env.PROVISION_TENANT_SLUG || 'damuon';
  const name = process.env.PROVISION_TENANT_NAME || 'کارگزاری رسمی بیمه آتیه اندیشان دامون';
  const kind = (process.env.PROVISION_TENANT_KIND || 'BROKER') as TenantKind;
  const adminUsername = process.env.PROVISION_ADMIN_USERNAME || 'admin';
  const superEmail = need('SUPER_ADMIN_EMAIL');

  const created: string[] = [];
  const credentials: string[] = [];

  // ── Tenant (never clobber an existing one's settings) ──
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, kind },
  });
  if (tenant.createdAt.getTime() > Date.now() - 10_000) created.push(`tenant "${slug}"`);

  // ── System roles (keep permissions in sync with the code's SYSTEM_ROLES) ──
  const roleIds: Record<string, string> = {};
  for (const [rname, permissions] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: rname } },
      update: { permissions },
      create: { tenantId: tenant.id, name: rname, permissions, isSystem: true },
    });
    roleIds[rname] = role.id;
  }

  // ── Org admin — create only if missing; NEVER reset an existing password in production ──
  const existingAdmin = await prisma.orgUser.findUnique({
    where: { tenantId_username: { tenantId: tenant.id, username: adminUsername } },
  });
  if (!existingAdmin) {
    const p = generatedPassword();
    await prisma.orgUser.create({
      data: {
        tenantId: tenant.id,
        username: adminUsername,
        displayName: 'مدیر سازمان',
        passwordHash: await argon2.hash(p, { type: argon2.argon2id }),
        roleId: roleIds['مدیر سازمان'],
      },
    });
    created.push('org admin');
    credentials.push(`Org admin username: ${adminUsername}`, `Org admin password: ${p}`);
  } else {
    await prisma.orgUser.update({ where: { id: existingAdmin.id }, data: { roleId: roleIds['مدیر سازمان'] } });
  }

  // ── Super admin — create only if missing ──
  const existingSuper = await prisma.superAdmin.findUnique({ where: { email: superEmail } });
  if (!existingSuper) {
    const p = generatedPassword();
    await prisma.superAdmin.create({
      data: { email: superEmail, passwordHash: await argon2.hash(p, { type: argon2.argon2id }) },
    });
    created.push('super admin');
    credentials.push(`Super admin email: ${superEmail}`, `Super admin password: ${p}`);
  }

  const out = [
    'OMR Damuon — PRODUCTION provisioning output',
    'KEEP SECRET. Change these passwords after first login, then delete this file.',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Tenant slug: ${slug}   (kind: ${kind})`,
    ...(credentials.length ? ['', ...credentials] : ['', '(no new credentials — users already existed)']),
  ].join('\n');
  writeFileSync(join(__dirname, 'provision-output.local.txt'), out, 'utf8');

  console.log(`Provisioning complete. Created: ${created.length ? created.join(', ') : 'nothing new'}.`);
  console.log('Credentials (if any) written to prisma/provision-output.local.txt — read, store safely, then delete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
