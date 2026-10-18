/**
 * One-time cleanup: remove DUPLICATE claims created before import de-duplication existed
 * (e.g. the same Excel file uploaded several times). Within each group of
 *   insurerTenantId + deceasedNationalCodeHash + claimType + eventDate
 * (= the same death event), it KEEPS the oldest claim (earliest createdAt) and deletes the rest,
 * along with their children (field values, steps, participants, deficiencies, document rows).
 *
 * Idempotent: once the data is clean, re-running deletes nothing. Prints a summary.
 *
 *   sudo -u omr bash -c 'set -a; source /etc/omr/api.env; set +a; \
 *     cd /opt/omr/apps/api && npx ts-node --transpile-only prisma/dedupe-claims.ts'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const claims = await prisma.claim.findMany({
    select: { id: true, claimNumber: true, insurerTenantId: true, deceasedNationalCodeHash: true, claimType: true, eventDate: true },
    orderBy: { createdAt: 'asc' }, // oldest first → the one we keep
  });

  const groups = new Map<string, string[]>();
  for (const c of claims) {
    const key = [c.insurerTenantId, c.deceasedNationalCodeHash, c.claimType, c.eventDate ? c.eventDate.toISOString() : 'null'].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c.id);
  }

  const toDelete: string[] = [];
  let dupGroups = 0;
  for (const ids of groups.values()) {
    if (ids.length <= 1) continue;
    dupGroups++;
    toDelete.push(...ids.slice(1)); // keep ids[0] (oldest), delete the rest
  }

  let deleted = 0;
  for (const id of toDelete) {
    await prisma.$transaction([
      prisma.documentReview.deleteMany({ where: { document: { claimId: id } } }), // FK RESTRICT → before documents
      prisma.claimFieldValue.deleteMany({ where: { claimId: id } }),
      prisma.claimDeficiency.deleteMany({ where: { claimId: id } }),
      prisma.claimStep.deleteMany({ where: { claimId: id } }),
      prisma.claimParticipant.deleteMany({ where: { claimId: id } }),
      prisma.document.deleteMany({ where: { claimId: id } }),
      prisma.claim.delete({ where: { id } }),
    ]);
    deleted++;
  }

  console.log(
    `Dedupe done: ${groups.size} unique claim group(s), ${dupGroups} had duplicates, ${deleted} duplicate claim(s) deleted.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
