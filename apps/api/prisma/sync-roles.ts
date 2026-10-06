/**
 * Idempotent system-role permission sync. Run on every deploy (after migrate deploy) so that
 * existing tenants pick up permissions added in new versions — WITHOUT touching passwords or
 * custom roles. Only roles marked isSystem whose name matches SYSTEM_ROLES are updated.
 *
 *   npx ts-node prisma/sync-roles.ts
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  let updated = 0;
  for (const t of tenants) {
    for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
      const res = await prisma.role.updateMany({
        where: { tenantId: t.id, name, isSystem: true },
        data: { permissions },
      });
      updated += res.count;
    }
  }
  console.log(`Synced system-role permissions: ${updated} role(s) across ${tenants.length} tenant(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
