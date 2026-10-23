/**
 * Alborz Insurance (بیمه البرز) presentation demo — run once on a dev/demo database:
 *
 *   npx ts-node --files prisma/seed-alborz-demo.ts    (from apps/api; needs `prisma db seed` first)
 *
 * Creates/updates the `alborz` INSURER tenant with its theme + logo, branches, one operator per desk
 * (شعبه، مدیریت ستاد، شورای فنی), the required-document catalog and the partnership with Damuon,
 * then drives the REAL workflow engine to leave demo claims at different stages (so every timeline,
 * letter and physical-document record is authentic). Passwords go to prisma/seed-output-alborz.local.txt.
 *
 * Refuses to run unless SMS_DRIVER=console (the engine notifies by SMS and the phones are fictional).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { SYSTEM_ROLES, PERMISSIONS } from '../src/common/rbac/permissions';
import { StorageService } from '../src/common/storage/storage.service';
import { requestContext, RequestContext } from '../src/common/tenant/tenant-context';
import { THEME_PRESETS } from '../src/modules/branding/theme';
import { ClaimsService } from '../src/modules/claims/claims.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { DEFAULT_REQUIRED_DOCS } from '../src/modules/required-docs/defaults';

const prisma = new PrismaClient();
const pw = () => randomBytes(9).toString('base64url');

const BRANCHES = [
  { code: '1001', name: 'شعبه مرکزی تهران' },
  { code: '2005', name: 'شعبه اصفهان' },
  { code: '3010', name: 'شعبه مشهد' },
];
const DESK_PERMS = [PERMISSIONS.CLAIM_READ, PERMISSIONS.CLAIM_PROCESS, PERMISSIONS.DOC_VERIFY, PERMISSIONS.DOC_READ, PERMISSIONS.EXPORT_LIST];

/** A valid Iranian national code from 9 seed digits (fictional people). */
function nid(nine: string): string {
  const d = nine.split('').map(Number);
  const sum = d.reduce((s, v, i) => s + v * (10 - i), 0) % 11;
  return nine + String(sum < 2 ? sum : 11 - sum);
}

function samplePdf(title: string): Buffer {
  const text = `SAMPLE DOCUMENT - ${title} - Alborz demo`;
  const stream = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function main() {
  if ((process.env.SMS_DRIVER ?? 'console') !== 'console') throw new Error('Set SMS_DRIVER=console — the demo claims notify fictional phones by SMS.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const claims = app.get(ClaimsService);
  const storage = app.get(StorageService);
  const customers = app.get(CustomerService);
  const creds: string[] = ['Alborz demo — local credentials (tenant slug: alborz)', `Login link: /org/login?org=alborz`, ''];

  // ── Tenant, theme, logo ──
  const damuon = await prisma.tenant.findUnique({ where: { slug: 'damuon' } });
  if (!damuon) throw new Error('Run `npx prisma db seed` first (Damuon tenant missing).');
  if (damuon.kind !== 'BROKER') await prisma.tenant.update({ where: { id: damuon.id }, data: { kind: 'BROKER' } });
  const alborz = await prisma.tenant.upsert({
    where: { slug: 'alborz' },
    update: { kind: 'INSURER', theme: THEME_PRESETS.alborz.theme as any },
    create: { slug: 'alborz', name: 'بیمه البرز', kind: 'INSURER', primaryColor: '#00bd9c', hqCeiling: '2000000000', contactHeader: 'شرکت بیمه البرز (سهامی عام)', theme: THEME_PRESETS.alborz.theme as any },
  });
  const logo = readFileSync(join(__dirname, '../../../docs/brand/alborz/alborz-logo-stacked.png'));
  const logoKey = await storage.save(alborz.id, logo);
  await prisma.tenant.update({ where: { id: alborz.id }, data: { logoKey: `${logoKey}|image/png` } });

  // ── Roles, branches, operators ──
  const role = (name: string, permissions: string[], isSystem = false) =>
    prisma.role.upsert({ where: { tenantId_name: { tenantId: alborz.id, name } }, update: { permissions }, create: { tenantId: alborz.id, name, permissions, isSystem } });
  for (const [name, perms] of Object.entries(SYSTEM_ROLES)) await role(name, perms, true);
  const adminRole = await role('مدیر سازمان', SYSTEM_ROLES['مدیر سازمان'], true);
  const branchRole = await role('کارشناس خسارت شعبه', DESK_PERMS);
  const hqRole = await role('کارشناس خسارت عمر و حوادث (ستاد)', DESK_PERMS);
  const councilRole = await role('عضو شورای فنی', DESK_PERMS);
  const branches: Record<string, string> = {};
  for (const b of BRANCHES) {
    const row = await prisma.branch.upsert({ where: { tenantId_code: { tenantId: alborz.id, code: b.code } }, update: { name: b.name }, create: { tenantId: alborz.id, ...b } });
    branches[b.code] = row.id;
  }
  const users: Record<string, { id: string; perms: string[]; branchId?: string }> = {};
  const user = async (username: string, displayName: string, roleRow: { id: string; permissions: string[] }, extra: { branchId?: string; desk?: 'HQ' | 'COUNCIL' }, seat: string) => {
    const password = pw();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const u = await prisma.orgUser.upsert({
      where: { tenantId_username: { tenantId: alborz.id, username } },
      update: { passwordHash, displayName, roleId: roleRow.id, branchId: extra.branchId ?? null, desk: extra.desk ?? null, isActive: true },
      create: { tenantId: alborz.id, username, displayName, passwordHash, roleId: roleRow.id, branchId: extra.branchId ?? null, desk: extra.desk ?? null },
    });
    users[username] = { id: u.id, perms: roleRow.permissions, branchId: extra.branchId };
    creds.push(`${seat.padEnd(24)} ${username} / ${password}`);
  };
  await user('admin', 'مدیر سامانه البرز', adminRole, { desk: 'HQ' }, 'مدیر سازمان (ستاد)');
  await user('tehran', 'کارشناس شعبه مرکزی تهران', branchRole, { branchId: branches['1001'] }, 'شعبه مرکزی تهران');
  await user('isfahan', 'کارشناس شعبه اصفهان', branchRole, { branchId: branches['2005'] }, 'شعبه اصفهان');
  await user('setad', 'کارشناس خسارت عمر و حوادث', hqRole, { desk: 'HQ' }, 'مدیریت ستاد');
  await user('shora', 'عضو شورای فنی', councilRole, { desk: 'COUNCIL' }, 'شورای فنی');

  // ── Catalog + partnership ──
  for (const d of DEFAULT_REQUIRED_DOCS) {
    await prisma.requiredDocument.upsert({ where: { tenantId_code: { tenantId: alborz.id, code: d.code } }, update: {}, create: { ...d, tenantId: alborz.id } });
  }
  await prisma.brokerInsurerPartnership.upsert({
    where: { brokerTenantId_insurerTenantId: { brokerTenantId: damuon.id, insurerTenantId: alborz.id } },
    update: { isActive: true }, create: { brokerTenantId: damuon.id, insurerTenantId: alborz.id },
  });

  // ── Demo claims (only once) ──
  if ((await prisma.claim.count({ where: { insurerTenantId: alborz.id } })) === 0) {
    const brokerAdmin = await prisma.orgUser.findFirst({ where: { tenantId: damuon.id, username: 'admin' }, include: { role: true } });
    if (!brokerAdmin) throw new Error('Damuon admin missing — run `npx prisma db seed`.');
    const as = <T>(u: { id: string; perms: string[]; branchId?: string }, tenantId: string, fn: () => Promise<T>) =>
      requestContext.run({ tenantId, actorType: 'ORG_USER', actorId: u.id, permissions: u.perms, branchId: u.branchId } as RequestContext, fn);
    const broker = { id: brokerAdmin.id, perms: brokerAdmin.role.permissions };
    const asBroker = <T>(fn: () => Promise<T>) => as(broker, damuon.id, fn);
    const asAlborz = <T>(name: string, fn: () => Promise<T>) => as(users[name], alborz.id, fn);

    // بیمه‌گزار: the employer company's account under the brokerage
    // The بیمه‌گزار company (the deceased's employer) with its Alborz contract, and its representative.
    const company = (await prisma.policyholderCompany.findFirst({ where: { tenantId: damuon.id, name: 'شرکت فولاد نمونه' } }))
      ?? await prisma.policyholderCompany.create({ data: { tenantId: damuon.id, name: 'شرکت فولاد نمونه', contactName: 'واحد رفاه کارکنان', phone: '021-88000000', email: 'refah@example.com', address: 'تهران، خیابان ولیعصر' } });
    if (!(await prisma.policyholderContract.count({ where: { companyId: company.id } }))) {
      await prisma.policyholderContract.create({ data: { companyId: company.id, insurerTenantId: alborz.id, policyNumber: '1403/105/979', startDate: new Date(Date.now() - 365 * 864e5) } });
    }
    let ph = await prisma.customerAccount.findFirst({ where: { tenantId: damuon.id } });
    if (!ph) {
      await asBroker(() => customers.createAccount({ nationalCode: nid('001035082'), phone: '09120000001', fullName: 'نمایندهٔ شرکت فولاد نمونه', companyId: company.id }));
      ph = await prisma.customerAccount.findFirst({ where: { tenantId: damuon.id } });
    }
    if (ph && !ph.companyId) await prisma.customerAccount.update({ where: { id: ph.id }, data: { companyId: company.id } });
    const docCodes = DEFAULT_REQUIRED_DOCS.filter((d) => d.appliesToTypes.includes('DEATH_ILLNESS')).map((d) => d.code);
    const labels = new Map(DEFAULT_REQUIRED_DOCS.map((d) => [d.code, d.label]));

    const file = async (name: string, nine: string, amount: string, daysAgo: number) => {
      const c: any = await asBroker(() => claims.file({
        insurerTenantId: alborz.id, channel: 'BROKER', brokerTenantId: damuon.id, claimType: 'DEATH_ILLNESS',
        eventDate: new Date(Date.now() - daysAgo * 864e5).toISOString(), claimedAmount: amount,
        deceasedFullName: name, deceasedNationalCode: nid(nine), policyHolderId: ph!.id, policyholderCompanyId: company.id, policyNumber: '1403/105/979',
        deceasedBirthDate: new Date(Date.now() - (45 + daysAgo % 20) * 365.25 * 864e5).toISOString(),
      }));
      for (const code of docCodes) {
        const buf = samplePdf(code);
        await asBroker(() => claims.uploadDocument(c.id, { buffer: buf, mimetype: 'application/pdf', originalname: `${labels.get(code)}.pdf`, size: buf.length } as any, code));
      }
      return c.id as string;
    };
    const approveAll = async (id: string, stage: 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL', run: <T>(fn: () => Promise<T>) => Promise<T>) => {
      const cl: any = await run(() => claims.checklist(id));
      for (const it of cl.items) if (it.documents[0]) await run(() => claims.reviewDocument(id, it.documents[0].id, stage, 'APPROVED'));
    };
    const tehran = <T>(fn: () => Promise<T>) => asAlborz('tehran', fn);
    const setad = <T>(fn: () => Promise<T>) => asAlborz('setad', fn);
    const shora = <T>(fn: () => Promise<T>) => asAlborz('shora', fn);
    const toBranch = async (id: string) => { await approveAll(id, 'BROKER', asBroker); await asBroker(() => claims.act(id, { action: 'FORWARD', branchId: branches['1001'], note: 'مدارک بررسی و تایید شد' })); };
    const branchToHq = async (id: string, notice: string) => {
      await approveAll(id, 'BRANCH', tehran);
      await tehran(() => claims.setLossNotice(id, notice));
      await tehran(() => claims.act(id, { action: 'REQUEST_PHYSICAL', note: 'لطفاً اصل مدارک ارسال شود' }));
      await asBroker(() => claims.physicalAct(id, { action: 'PHYSICAL_SEND', trackingNo: '2204561234' }));
      await tehran(() => claims.physicalAct(id, { action: 'PHYSICAL_RECEIVE' }));
      await tehran(() => claims.act(id, { action: 'FORWARD' }));
    };

    // 1) just filed — waiting at کارگزاری
    await file('علی رضایی', '012345678', '850000000', 6);
    // 2) at شعبه
    const c2 = await file('مریم احمدی', '023456781', '1200000000', 12); await toBranch(c2);
    // 3) at مدیریت ستاد (loss notice + originals at شعبه)
    const c3 = await file('حسین کریمی', '034567812', '950000000', 20); await toBranch(c3); await branchToHq(c3, 'AL-1403-55021');
    // 4) returned by شعبه to کارگزاری (a document rejected), waiting to be passed down
    const c4 = await file('زهرا موسوی', '045678123', '700000000', 15); await toBranch(c4);
    const d4: any = await tehran(() => claims.checklist(c4));
    await tehran(() => claims.reviewDocument(c4, d4.items[0].documents[0].id, 'BRANCH', 'REJECTED', 'تصویر ناخوانا است'));
    await tehran(() => claims.act(c4, { action: 'RETURN', deficiencies: ['ارسال تصویر خوانا از گواهی فوت'] }));
    // 5) above the ستاد ceiling → شورای فنی → paid by شعبه
    const c5 = await file('محمد حسینی', '056781234', '3500000000', 40); await toBranch(c5); await branchToHq(c5, 'AL-1403-54877');
    await approveAll(c5, 'HQ', setad);
    await setad(() => claims.setFinalizedAmount(c5, '3200000000'));
    await setad(() => claims.act(c5, { action: 'REFER_COUNCIL', note: 'مبلغ بیش از سقف اختیار ستاد' }));
    await approveAll(c5, 'COUNCIL', shora);
    await shora(() => claims.act(c5, { action: 'PAY_ORDER', note: 'تصویب در جلسهٔ شورای فنی' }));
    await setad(() => claims.act(c5, { action: 'DOWN_FORWARD' }));
    await tehran(() => claims.act(c5, { action: 'MARK_PAID', note: 'واریز به حساب وراث قانونی' }));
    creds.push('', 'Demo claims: 1 at کارگزاری, 1 at شعبه, 1 at ستاد, 1 returned (at کارگزاری, going down), 1 paid via شورای فنی.');
  } else {
    creds.push('', 'Demo claims already exist — left as they are (only theme, logo, users and passwords refreshed).');
  }

  writeFileSync(join(__dirname, 'seed-output-alborz.local.txt'), creds.join('\n') + '\n');
  await app.close();
  console.log('Alborz demo ready. Credentials written to prisma/seed-output-alborz.local.txt');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
