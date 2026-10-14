/**
 * Refresh every INSURER's required-document catalog to match prisma defaults
 * (apps/api/src/modules/required-docs/defaults.ts): updates the label / order / appliesToTypes of
 * each document BY CODE, and adds any new codes. Non-destructive — it never deletes a document, so
 * custom additions and all uploaded files (matched by docCode) are preserved.
 *
 * Run after editing required-docs/defaults.ts, as the omr user with the DB env loaded:
 *   set -a; source /etc/omr/api.env; set +a
 *   sudo -u omr -E bash -c 'cd /opt/omr/apps/api && npx ts-node prisma/update-required-docs.ts'
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_REQUIRED_DOCS } from '../src/modules/required-docs/defaults';

(async () => {
  const prisma = new PrismaClient();
  const insurers = await prisma.tenant.findMany({ where: { kind: 'INSURER' }, select: { id: true, slug: true } });
  let upserts = 0;
  for (const t of insurers) {
    for (const d of DEFAULT_REQUIRED_DOCS) {
      await prisma.requiredDocument.upsert({
        where: { tenantId_code: { tenantId: t.id, code: d.code } },
        update: { label: d.label, appliesToTypes: d.appliesToTypes, order: d.order },
        create: { tenantId: t.id, code: d.code, label: d.label, appliesToTypes: d.appliesToTypes, order: d.order },
      });
      upserts++;
    }
    console.log(`refreshed ${t.slug}`);
  }
  console.log(`done — ${insurers.length} insurer(s), ${upserts} upserts`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
