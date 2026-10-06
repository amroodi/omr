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
 * Credentials are printed to the terminal AND (best-effort) written to ~/omr-provision-output.txt
 * (override with PROVISION_OUT=/path). It never crashes if that file can't be written.
 *
 * Optional overrides: PROVISION_TENANT_SLUG (default "damuon"), PROVISION_TENANT_NAME,
 * PROVISION_TENANT_KIND (BROKER|INSURER, default BROKER), PROVISION_ADMIN_USERNAME (default "admin"),
 * PROVISION_RESET=true (reset the admin/super-admin password if the account already exists).
 */
import { PrismaClient, TenantKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { homedir } from 'os';
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
  const reset = process.env.PROVISION_RESET === 'true';

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

  // ── Org admin — create if missing; with PROVISION_RESET=true, reset an existing password too ──
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
  } else if (reset) {
    const p = generatedPassword();
    await prisma.orgUser.update({
      where: { id: existingAdmin.id },
      data: { passwordHash: await argon2.hash(p, { type: argon2.argon2id }), roleId: roleIds['مدیر سازمان'] },
    });
    created.push('org admin password RESET');
    credentials.push(`Org admin username: ${adminUsername}`, `Org admin password: ${p}`);
  } else {
    await prisma.orgUser.update({ where: { id: existingAdmin.id }, data: { roleId: roleIds['مدیر سازمان'] } });
  }

  // ── Super admin — create if missing; with PROVISION_RESET=true, reset an existing password too ──
  const existingSuper = await prisma.superAdmin.findUnique({ where: { email: superEmail } });
  if (!existingSuper) {
    const p = generatedPassword();
    await prisma.superAdmin.create({
      data: { email: superEmail, passwordHash: await argon2.hash(p, { type: argon2.argon2id }) },
    });
    created.push('super admin');
    credentials.push(`Super admin email: ${superEmail}`, `Super admin password: ${p}`);
  } else if (reset) {
    const p = generatedPassword();
    await prisma.superAdmin.update({
      where: { id: existingSuper.id },
      data: { passwordHash: await argon2.hash(p, { type: argon2.argon2id }) },
    });
    created.push('super admin password RESET');
    credentials.push(`Super admin email: ${superEmail}`, `Super admin password: ${p}`);
  }

  const out = [
    'OMR Damuon — PRODUCTION provisioning output',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Tenant slug: ${slug}   (kind: ${kind})`,
    ...(credentials.length ? ['', ...credentials] : ['', '(no new credentials — users already existed; pass PROVISION_RESET=true to reset)']),
  ].join('\n');

  // Terminal is the reliable channel for interactive provisioning. Also try to drop a file in a
  // writable location (best-effort) — never crash if the repo dir isn't writable by this user.
  let savedTo = '';
  if (credentials.length) {
    const target = process.env.PROVISION_OUT || join(homedir(), 'omr-provision-output.txt');
    try {
      writeFileSync(target, out + '\n', { encoding: 'utf8', mode: 0o600 });
      savedTo = target;
    } catch {
      /* ignore — the credentials are printed below regardless */
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(out);
  console.log('='.repeat(60));
  if (credentials.length) {
    console.log('⚠  COPY these now, change the passwords after first login, then clear your terminal.');
    if (savedTo) console.log(`   A copy was also written to: ${savedTo}  (delete it once stored safely)`);
    else console.log('   (Could not write a file; use the values above.)');
  }
  console.log(`Provisioning complete. ${created.length ? 'Changes: ' + created.join(', ') : 'Nothing new.'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
