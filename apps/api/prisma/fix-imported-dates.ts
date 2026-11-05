/**
 * Cases brought in from Excel before the importer knew that the register's «تاریخ پرداخت» column often
 * holds the deceased's BIRTH date: give them their birth date (case column + «تاریخ تولد» field, so the
 * age at death is computed) — or, when that column really is a payment date, the «تاریخ حواله پرداخت»
 * field. Same rule as the importer (paidColIsBirth). Only fills what is empty, so it runs on every
 * deploy and touches nothing twice.
 *
 *   npx ts-node prisma/fix-imported-dates.ts
 */
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jalaali: { toGregorian(y: number, m: number, d: number): { gy: number; gm: number; gd: number } } = require('jalaali-js');

const toAsciiDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
/** As common/jalali fromJalali: midnight in Tehran. */
const fromJalali = (s: string) => { const [y, m, d] = s.split('/').map(Number); const g = jalaali.toGregorian(y, m, d); return new Date(Date.UTC(g.gy, g.gm - 1, g.gd) - 210 * 60 * 1000); };
/** As the importer's paidColIsBirth: before the death date (or, with none, a year before 1380) = a birth date. */
function paidColIsBirth(d: { paidDateCol: string; deathDate: string }): boolean {
  const norm = (v: string) => v.split('/').map((x, i) => (i ? x.padStart(2, '0') : x)).join('/');
  const paid = norm(d.paidDateCol);
  if (!/^\d{4}\//.test(paid)) return false;
  const death = norm(d.deathDate);
  if (/^\d{4}\//.test(death)) return paid < death;
  return Number(paid.slice(0, 4)) < 1380;
}

const prisma = new PrismaClient();
const clean = (v: unknown) => {
  const s = toAsciiDigits(String(v ?? '')).trim().replace(/-/g, '/');
  return /^\d{3,4}\/\d{1,2}\/\d{1,2}$/.test(s) ? s : '';
};
const dateOf = (s: string) => { try { const d = fromJalali(s); return isNaN(d.getTime()) ? null : d; } catch { return null; } };

async function main(): Promise<void> {
  let births = 0;
  let payments = 0;
  const claims = await prisma.claim.findMany({ where: { imported: true }, select: { id: true, deceasedBirthDate: true, legacyData: true } });
  for (const c of claims) {
    const raw = (c.legacyData && typeof c.legacyData === 'object' ? c.legacyData : {}) as Record<string, unknown>;
    const paidCol = clean(raw['تاریخ پرداخت']);
    const birthCol = clean(raw['تاریخ تولد']);
    if (!paidCol && !birthCol) continue;
    const fields = await prisma.claimFieldValue.findMany({ where: { claimId: c.id, key: { in: ['birth_date', 'payment_order_date'] } }, select: { key: true, value: true } });
    const has = (k: string) => !!clean(fields.find((f) => f.key === k)?.value);
    const isBirth = paidColIsBirth({ paidDateCol: paidCol, deathDate: clean(raw['تاریخ فوت']) });
    const birth = birthCol || (isBirth ? paidCol : '');
    if (birth) {
      const d = dateOf(birth);
      let changed = false;
      if (!c.deceasedBirthDate && d) { await prisma.claim.update({ where: { id: c.id }, data: { deceasedBirthDate: d } }); changed = true; }
      if (!has('birth_date')) {
        await prisma.claimFieldValue.upsert({
          where: { claimId_key: { claimId: c.id, key: 'birth_date' } },
          update: { value: birth }, create: { claimId: c.id, key: 'birth_date', value: birth, source: 'MANUAL', confirmedAt: new Date() },
        });
        changed = true;
      }
      if (changed) births++;
    }
    if (paidCol && !isBirth && !has('payment_order_date')) {
      await prisma.claimFieldValue.upsert({
        where: { claimId_key: { claimId: c.id, key: 'payment_order_date' } },
        update: { value: paidCol }, create: { claimId: c.id, key: 'payment_order_date', value: paidCol, source: 'MANUAL', confirmedAt: new Date() },
      });
      payments++;
    }
  }
  console.log(`Imported cases repaired: ${births} birth date(s), ${payments} payment date(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
