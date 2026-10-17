/**
 * Daily purge of the claims recycle bin. Permanently deletes claims whose soft-delete retention
 * window (14 days) has elapsed — along with their children (field values, steps, participants,
 * deficiencies, document rows) and the encrypted document files. Soft-deleted claims still within
 * the window are kept (restorable). The AUDIT LOG is never touched: the deletion history stays
 * forever.
 *
 * Run once a day (cron / systemd timer) as the omr user:
 *   sudo -u omr bash -c 'set -a; source /etc/omr/api.env; set +a; \
 *     cd /opt/omr/apps/api && npx ts-node --transpile-only prisma/purge-deleted-claims.ts'
 */
import { PrismaClient } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join, resolve } from 'path';

const RETENTION_DAYS = 14; // keep in sync with CLAIM_RETENTION_DAYS in claims.service.ts
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const baseDir = resolve(process.env.STORAGE_DIR || '.storage');
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  const expired = await prisma.claim.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } });

  let purged = 0;
  let files = 0;
  for (const c of expired) {
    const docs = await prisma.document.findMany({ where: { claimId: c.id }, select: { storageKey: true } });
    await prisma.$transaction([
      prisma.claimFieldValue.deleteMany({ where: { claimId: c.id } }),
      prisma.claimDeficiency.deleteMany({ where: { claimId: c.id } }),
      prisma.claimStep.deleteMany({ where: { claimId: c.id } }),
      prisma.claimParticipant.deleteMany({ where: { claimId: c.id } }),
      prisma.document.deleteMany({ where: { claimId: c.id } }),
      prisma.claim.delete({ where: { id: c.id } }),
    ]);
    for (const d of docs) {
      try { await unlink(join(baseDir, d.storageKey)); files++; } catch { /* already gone */ }
    }
    purged++;
  }

  console.log(`Purge done: ${purged} expired claim(s) permanently deleted (${files} file(s) removed). Audit log retained.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
