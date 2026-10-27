/// <reference path="../src/types/jalaali-js.d.ts" />
/**
 * Give every case still carrying an old «CLM-00042» number the new «سال/شماره بیمه‌نامه/n» number
 * (e.g. 1405/618/01). Idempotent — runs on every deploy and only touches CLM- numbers, oldest first.
 * The year is the year the case was filed (Tehran), or for an imported historical case the year of death.
 *
 *   npx ts-node prisma/renumber-claims.ts
 */
import { PrismaClient } from '@prisma/client';
import { nextClaimNumber } from '../src/modules/claims/claim-number';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const old = await prisma.claim.findMany({
    where: { claimNumber: { startsWith: 'CLM-' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, claimNumber: true, policyNumber: true, createdAt: true, eventDate: true, imported: true },
  });
  for (const c of old) {
    const at = c.imported ? c.eventDate ?? c.createdAt : c.createdAt;
    const claimNumber = await nextClaimNumber(prisma as any, c.policyNumber, at);
    await prisma.claim.update({ where: { id: c.id }, data: { claimNumber } });
  }
  console.log(`Renumbered ${old.length} case(s) to «year/policy/n».`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
