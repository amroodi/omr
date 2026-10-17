/**
 * One-time, idempotent backfill: populate ClaimFieldValue rows for claims that were bulk-imported
 * BEFORE the importer began writing per-field values (commit 3da8ef7). Those claims hold their data
 * only in the canonical columns + the legacyData JSON blob, so «اطلاعات پرونده و بیمه‌نامه» shows
 * blank for them. This fills each field from those sources.
 *
 * SAFE TO RE-RUN: it never overwrites an existing value (a human may have already corrected a
 * field) — it only creates values for keys that have none yet.
 *
 *   # On the server, as the omr user, with the API env sourced (for the crypto key + DB URL):
 *   sudo -u omr bash -c 'set -a; source /etc/omr/api.env; set +a; \
 *     cd /opt/omr/apps/api && npx ts-node --transpile-only prisma/backfill-imported-claim-fields.ts'
 *
 * (--transpile-only: this script imports jalali.util, which pulls in the untyped `jalaali-js`
 *  module; ts-node's type-checker would otherwise reject it with TS7016. The code is type-checked
 *  by the normal build, so skipping the check here is safe.)
 */
import { FieldSource, PrismaClient } from '@prisma/client';
import { decryptValue } from '../src/common/crypto/field-crypto.core';
import { toAsciiDigits, toJalali } from '../src/common/jalali/jalali.util';

const prisma = new PrismaClient();

/** Build the decryption key map from the same env the API uses (FIELD_ENCRYPTION_KEY[_VERSION]). */
function cryptoKeys(): Map<string, Buffer> {
  const version = process.env.FIELD_ENCRYPTION_KEY_VERSION || '1';
  const b64 = process.env.FIELD_ENCRYPTION_KEY || '';
  if (!b64) throw new Error('FIELD_ENCRYPTION_KEY is not set — run: set -a; source /etc/omr/api.env; set +a');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to 32 bytes');
  return new Map([[version, key]]);
}

const amount = (v: unknown): string | null => {
  if (v == null) return null;
  const digits = toAsciiDigits(String(v)).replace(/[^\d]/g, '');
  return digits.length ? digits : null;
};
const dateStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = toAsciiDigits(String(v)).trim();
  return s.length ? s : null;
};

async function main(): Promise<void> {
  const keys = cryptoKeys();
  const dec = (c: string | null | undefined): string | null => {
    try { return c ? decryptValue(keys, c) : null; } catch { return null; }
  };

  const claims = await prisma.claim.findMany({ where: { imported: true } });
  let scanned = 0;
  let created = 0;
  let noData = 0;

  for (const c of claims) {
    scanned++;
    const legacy = (c.legacyData && typeof c.legacyData === 'object' ? c.legacyData : {}) as Record<string, unknown>;
    const fromLegacy = (...headers: string[]): unknown => {
      for (const h of headers) if (legacy[h] != null && String(legacy[h]).trim()) return legacy[h];
      return null;
    };

    const pairs: [string, string | null][] = [
      ['full_name', dec(c.deceasedFullName)],
      ['national_code', dec(c.deceasedNationalCode)],
      ['death_date', c.eventDate ? toAsciiDigits(toJalali(c.eventDate, false)) : dateStr(fromLegacy('تاریخ فوت'))],
      ['cause_of_death', (c.causeOfDeath ?? (fromLegacy('علت فوت') as string | null)) || null],
      ['policy_number', (c.policyNumber ?? (fromLegacy('شماره بیمه‌نامه', 'شماره بیمه نامه') as string | null)) || null],
      ['company_name', (c.employerName ?? (fromLegacy('نام شرکت محل فعالیت') as string | null)) || null],
      ['beneficiary_type', (c.beneficiaryType ?? (fromLegacy('نوع ذینفع') as string | null)) || null],
      ['birth_date', dateStr(fromLegacy('تاریخ تولد'))],
      ['policy_start_date', dateStr(fromLegacy('تاریخ شروع بیمه نامه', 'تاریخ شروع بیمه‌نامه'))],
      ['death_capital', amount(fromLegacy('سرمایه فوت'))],
      ['accident_capital', amount(fromLegacy('سرمایه حادثه'))],
      ['payable_amount', amount(fromLegacy('مبلغ قابل پرداخت'))],
    ];

    const toWrite = pairs.filter(([, v]) => v != null && String(v).trim().length > 0) as [string, string][];
    if (!toWrite.length) { noData++; continue; }

    // Never overwrite an existing value — only fill keys that have none.
    const existing = new Set(
      (await prisma.claimFieldValue.findMany({ where: { claimId: c.id }, select: { key: true } })).map((x) => x.key),
    );
    const fresh = toWrite.filter(([k]) => !existing.has(k));
    if (!fresh.length) continue;

    await prisma.claimFieldValue.createMany({
      data: fresh.map(([key, value]) => ({ claimId: c.id, key, value, source: FieldSource.MANUAL, confirmedAt: new Date() })),
      skipDuplicates: true,
    });
    created += fresh.length;
  }

  console.log(
    `Backfill done: ${scanned} imported claim(s) scanned, ${created} field value(s) created, ${noData} claim(s) had no fillable data.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
