/**
 * Sync each tenant's existing ClaimFieldDef rows' TYPE + OPTIONS to match the current default
 * catalog (apps/api/src/modules/claim-fields/defaults.ts) — e.g. turning the وضعیت workflow fields
 * into SELECT drop-downs with preset options. Only presentation attributes (type, options) are
 * touched; labels, editableBy, order, required and any custom fields are left as-is. Missing fields
 * are NOT created here (that's seedDefaults). Idempotent.
 *
 *   sudo -u omr bash -c 'set -a; source /etc/omr/api.env; set +a; \
 *     cd /opt/omr/apps/api && npx ts-node --transpile-only prisma/sync-claim-field-types.ts'
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_CLAIM_FIELDS } from '../src/modules/claim-fields/defaults';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let updated = 0;
  for (const t of tenants) {
    for (const d of DEFAULT_CLAIM_FIELDS) {
      const res = await prisma.claimFieldDef.updateMany({
        where: { tenantId: t.id, key: d.key },
        data: { type: d.type, options: d.options ?? [] },
      });
      updated += res.count;
    }
  }
  console.log(`Synced claim-field types/options: ${updated} field(s) across ${tenants.length} tenant(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
