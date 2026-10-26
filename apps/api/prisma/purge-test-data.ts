/**
 * One-off clean-up after acceptance testing: permanently deletes every claim (پرونده) with all of its
 * documents, reviews, steps, letters, physical-document records and stored files, and the test
 * بیمه‌گزار companies — the ones added by hand without a «کد بیمه‌گزار» (companies imported from the
 * insurer's Excel always have one) — with their contracts and representative accounts.
 *
 * DRY RUN by default: it only lists what would be deleted. Nothing changes without --confirm.
 *
 *   cd /opt/omr/apps/api && set -a && source /etc/omr/api.env && set +a
 *   npx ts-node prisma/purge-test-data.ts                 # show what would be deleted
 *   npx ts-node prisma/purge-test-data.ts --confirm       # delete it (irreversible)
 *
 * Options:
 *   --tenant=damuon        brokerage whose test companies are removed (default damuon)
 *   --include-imported     also delete claims brought in by «ورود دسته‌ای» (kept by default)
 *   --keep-companies       delete claims only
 * The audit log is kept untouched (it is hash-chained).
 */
import { PrismaClient } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join, resolve } from 'path';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (name: string, def: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;

const CONFIRM = flag('--confirm');
const TENANT = opt('tenant', 'damuon');
const INCLUDE_IMPORTED = flag('--include-imported');
const KEEP_COMPANIES = flag('--keep-companies');
const STORAGE_DIR = resolve(process.env.STORAGE_DIR || '.storage');

async function removeFile(key: string | null) {
  if (!key) return;
  const full = resolve(join(STORAGE_DIR, key));
  if (!full.startsWith(STORAGE_DIR)) return; // never outside the storage folder
  try { await unlink(full); } catch { /* already gone */ }
}

async function main() {
  const claims = await prisma.claim.findMany({
    where: INCLUDE_IMPORTED ? {} : { imported: false },
    select: { id: true, claimNumber: true },
    orderBy: { claimNumber: 'asc' },
  });
  const keptImported = INCLUDE_IMPORTED ? 0 : await prisma.claim.count({ where: { imported: true } });

  const broker = await prisma.tenant.findUnique({ where: { slug: TENANT }, select: { id: true, name: true } });
  const companies = KEEP_COMPANIES || !broker ? [] : await prisma.policyholderCompany.findMany({
    where: { tenantId: broker.id, code: null },
    select: { id: true, name: true, _count: { select: { contracts: true, accounts: true } } },
  });

  console.log(`\n${CONFIRM ? 'DELETING' : 'DRY RUN — nothing is deleted (add --confirm to delete)'}\n`);
  console.log(`Claims to delete: ${claims.length}${claims.length ? ` (${claims.slice(0, 30).map((c) => c.claimNumber).join(', ')}${claims.length > 30 ? ', …' : ''})` : ''}`);
  if (keptImported) console.log(`Imported (historical) claims kept: ${keptImported} — add --include-imported to delete them too`);
  if (!broker && !KEEP_COMPANIES) console.log(`Brokerage "${TENANT}" not found — no companies removed`);
  console.log(`Test بیمه‌گزار companies (no کد بیمه‌گزار) to delete in "${broker?.name ?? TENANT}": ${companies.length}`);
  for (const c of companies) console.log(`  - ${c.name}  (${c._count.contracts} contract(s), ${c._count.accounts} representative account(s))`);

  if (!CONFIRM) { console.log('\nRun again with --confirm to delete the above.'); return; }

  // ── Claims (same order as ClaimsService.hardDelete: no DB cascades exist) ──
  let files = 0;
  for (const c of claims) {
    const docs = await prisma.document.findMany({ where: { claimId: c.id }, select: { storageKey: true } });
    const letters = await prisma.claimLetter.findMany({ where: { claimId: c.id, storageKey: { not: null } }, select: { storageKey: true } });
    await prisma.$transaction([
      prisma.documentReview.deleteMany({ where: { document: { claimId: c.id } } }),
      prisma.claimPhysicalEvent.deleteMany({ where: { claimId: c.id } }),
      prisma.claimPhysicalRequest.deleteMany({ where: { claimId: c.id } }),
      prisma.claimLetter.deleteMany({ where: { claimId: c.id } }),
      prisma.claimFieldValue.deleteMany({ where: { claimId: c.id } }),
      prisma.claimDeficiency.deleteMany({ where: { claimId: c.id } }),
      prisma.claimStep.deleteMany({ where: { claimId: c.id } }),
      prisma.claimParticipant.deleteMany({ where: { claimId: c.id } }),
      prisma.inquiryMessage.deleteMany({ where: { claimId: c.id } }),
      prisma.otpChallenge.deleteMany({ where: { claimId: c.id } }),
      prisma.notification.deleteMany({ where: { link: { contains: c.id } } }),
      prisma.document.deleteMany({ where: { claimId: c.id } }),
      prisma.claim.delete({ where: { id: c.id } }),
    ]);
    for (const d of [...docs, ...letters]) { await removeFile(d.storageKey); files++; }
  }

  // ── Test companies, their contracts and representative accounts ──
  for (const co of companies) {
    const accounts = await prisma.customerAccount.findMany({ where: { companyId: co.id }, select: { id: true } });
    const ids = accounts.map((a) => a.id);
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { recipientId: { in: ids } } }),
      prisma.inquiryMessage.deleteMany({ where: { companyId: co.id } }),
      prisma.customerAccount.deleteMany({ where: { id: { in: ids } } }),
      prisma.policyholderContract.deleteMany({ where: { companyId: co.id } }),
      prisma.policyholderCompany.updateMany({ where: { parentId: co.id }, data: { parentId: null } }),
      prisma.policyholderCompany.delete({ where: { id: co.id } }),
    ]);
  }

  console.log(`\nDone: ${claims.length} claim(s), ${files} stored file(s), ${companies.length} company(ies) deleted.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
