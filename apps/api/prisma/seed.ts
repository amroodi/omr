/**
 * Seed script — provisions the default Damuon tenant, system roles, a super-admin, an org admin,
 * and a small set of CLEARLY-FAKE sample records so the OTP inquiry flow is testable end to end.
 *
 * Run:  npx prisma db seed   (Prisma loads apps/api/.env)
 *
 * Generated credentials are written to prisma/seed-output.local.txt (gitignored), never printed.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { blindIndexValue, encryptValue } from '../src/common/crypto/field-crypto.core';
import { SYSTEM_ROLES } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('REPLACE_ME')) {
    throw new Error(`${name} must be set in apps/api/.env before seeding.`);
  }
  return v;
}

function randomPassword(): string {
  return randomBytes(12).toString('base64url');
}

function hashOtp(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${createHash('sha256').update(salt + code).digest('hex')}`;
}

async function main(): Promise<void> {
  const version = process.env.FIELD_ENCRYPTION_KEY_VERSION || '1';
  const key = Buffer.from(requireEnv('FIELD_ENCRYPTION_KEY'), 'base64').subarray(0, 32);
  const pepper = Buffer.from(requireEnv('BLIND_INDEX_PEPPER'), 'base64');
  const enc = (v: string) => encryptValue(key, version, v);
  const bi = (v: string) => blindIndexValue(pepper, v);

  // ── Tenant ────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'damuon' },
    update: {},
    create: {
      slug: 'damuon',
      name: 'کارگزاری رسمی بیمه آتیه اندیشان دامون',
      primaryColor: '#0ea5e9',
      contactHeader: 'کارگزاری آتیه اندیشان دامون — info@bimmes.ir — ۰۲۱۵۷۳۸۹۰۰۰',
      fontFamily: 'IRANYekanX',
    },
  });

  // ── Roles ─────────────────────────────────────────────────────────────
  const roleIds: Record<string, string> = {};
  for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: { permissions },
      create: { tenantId: tenant.id, name, permissions, isSystem: true },
    });
    roleIds[name] = role.id;
  }

  // ── Users (random passwords) ───────────────────────────────────────────
  const adminPw = randomPassword();
  const superPw = randomPassword();

  // Reset the password on re-seed too, so prisma/seed-output.local.txt always matches the DB.
  const adminHash = await argon2.hash(adminPw, { type: argon2.argon2id });
  await prisma.orgUser.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'admin' } },
    update: { passwordHash: adminHash, roleId: roleIds['مدیر سازمان'] },
    create: {
      tenantId: tenant.id,
      username: 'admin',
      displayName: 'مدیر دامون',
      passwordHash: adminHash,
      roleId: roleIds['مدیر سازمان'],
    },
  });

  const superHash = await argon2.hash(superPw, { type: argon2.argon2id });
  await prisma.superAdmin.upsert({
    where: { email: 'superadmin@damuon.local' },
    update: { passwordHash: superHash },
    create: {
      email: 'superadmin@damuon.local',
      passwordHash: superHash,
    },
  });

  // ── CLEARLY-FAKE sample record (test data only) ────────────────────────
  const fakeNid = '0011223344';
  const fakePhone = '09120000000';
  const insured = await prisma.insuredParty.upsert({
    where: { tenantId_nationalCodeHash: { tenantId: tenant.id, nationalCodeHash: bi(fakeNid) } },
    update: {},
    create: {
      tenantId: tenant.id,
      nationalCode: enc(fakeNid),
      nationalCodeHash: bi(fakeNid),
      fullName: enc('بیمه‌گذار نمونه'),
      phone: enc(fakePhone),
      phoneHash: bi(fakePhone),
      dateOfDeath: new Date('2025-03-10'),
    },
  });

  // Customer login account for the same fake person (customer realm).
  await prisma.customerAccount.upsert({
    where: { tenantId_nationalCodeHash: { tenantId: tenant.id, nationalCodeHash: bi(fakeNid) } },
    update: {},
    create: {
      tenantId: tenant.id,
      nationalCode: enc(fakeNid),
      nationalCodeHash: bi(fakeNid),
      fullName: enc('بیمه‌گذار نمونه'),
      phone: enc(fakePhone),
      phoneHash: bi(fakePhone),
    },
  });

  const policy = await prisma.policy.upsert({
    where: { tenantId_policyNumber: { tenantId: tenant.id, policyNumber: 'TEST-0001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      insuredId: insured.id,
      policyNumber: 'TEST-0001',
      carrier: 'البرز',
      productType: 'عمر و حادثه',
      startDate: new Date('2020-01-01'),
      status: 'ACTIVE',
    },
  });

  const kase = await prisma.case.upsert({
    where: { tenantId_caseNumber: { tenantId: tenant.id, caseNumber: 'CASE-0001' } },
    update: {},
    create: {
      tenantId: tenant.id,
      caseNumber: 'CASE-0001',
      insuredId: insured.id,
      policyId: policy.id,
      status: 'REVIEWING',
      stageDate: new Date('2025-04-01'),
      docsRequestedAt: new Date('2025-04-05'),
    },
  });

  await prisma.payment.deleteMany({ where: { tenantId: tenant.id, caseId: kase.id } });
  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      caseId: kase.id,
      date: new Date('2025-05-01'),
      description: 'پیش‌پرداخت',
      amount: '50000000',
      status: 'PAID',
    },
  });

  // Pre-seed an OTP the dev can use directly (dev only), plus write all creds to a local file.
  const devOtp = '123456';
  await prisma.otpChallenge.create({
    data: {
      tenantId: tenant.id,
      purpose: 'inquiry',
      phoneHash: bi(fakePhone),
      insuredId: insured.id,
      caseId: kase.id,
      codeHash: hashOtp(devOtp),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  // And a customer-realm OTP so the customer login is testable too.
  await prisma.otpChallenge.create({
    data: {
      tenantId: tenant.id,
      purpose: 'customer',
      phoneHash: bi(fakePhone),
      codeHash: hashOtp(devOtp),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  const out = [
    'OMR Damuon — seed output (DEV ONLY, do not commit)',
    '',
    `Tenant slug:        damuon`,
    `Org admin username: admin`,
    `Org admin password: ${adminPw}`,
    `Super admin email:  superadmin@damuon.local`,
    `Super admin pass:   ${superPw}`,
    '',
    'Sample inquiry (send header  x-tenant-slug: damuon):',
    `  nationalCode: ${fakeNid}   phone: ${fakePhone}`,
    `  pre-seeded OTP (valid 1h):  ${devOtp}`,
  ].join('\n');
  writeFileSync(join(__dirname, 'seed-output.local.txt'), out, 'utf8');
  console.log('Seed complete. Credentials written to prisma/seed-output.local.txt');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
