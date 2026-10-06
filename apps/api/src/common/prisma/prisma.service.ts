import { INestApplication, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getContext } from '../tenant/tenant-context';

/**
 * Models that carry a `tenantId` and must be auto-scoped to the current tenant.
 * Keep in sync with schema.prisma.
 */
const TENANT_MODELS = new Set<string>([
  'Branch',
  'Role',
  'OrgUser',
  'CustomerAccount',
  'InsuredParty',
  'Beneficiary',
  'Policy',
  'Case',
  'Payment',
  'Document',
  'OtpChallenge',
  'AuditLog',
  'ApprovalLevel',
  'RequiredDocument',
  'ClaimFieldDef',
  'ApiKey',
  'Notification',
]);

const READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);

/**
 * Tenant-isolating Prisma client.
 *
 * A query extension injects `tenantId` into every read/write on tenant-owned models, using the
 * AsyncLocalStorage request context. This is the second of three isolation layers (guard,
 * this extension, composite unique constraints) so one forgotten `where` cannot leak data.
 *
 * `unscoped()` returns the raw client for the few legitimate cross-tenant operations
 * (super-admin provisioning, OTP cleanup jobs). Use it deliberately.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  public readonly scoped: ReturnType<PrismaService['buildScoped']>;

  constructor() {
    super({ log: ['warn', 'error'] });
    this.scoped = this.buildScoped();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  /** Raw, un-scoped client — cross-tenant. Use only where tenant isolation must be bypassed. */
  unscoped(): PrismaClient {
    return this;
  }

  private buildScoped() {
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_MODELS.has(model)) return query(args);
            const ctx = getContext();
            const tenantId = ctx?.tenantId;
            if (!tenantId) {
              throw new Error(
                `Tenant-scoped ${operation} on ${model} attempted with no tenant in context.`,
              );
            }
            const a: any = args ?? {};

            // Note: findUnique/findUniqueOrThrow are intentionally NOT injected here — Prisma
            // only accepts unique inputs in their `where`. Tenant-scoped code must use findFirst
            // (which is injected below); a lint rule / review should forbid findUnique in
            // tenant services. buildScoped throws above if there is no tenant, as a backstop.
            if (READ_OPS.has(operation)) {
              a.where = { ...(a.where ?? {}), tenantId };
            } else if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              // Enforce post-hoc: run the query, then verify the row belongs to the tenant.
              const row: any = await query(a);
              if (row && row.tenantId && row.tenantId !== tenantId) return null as any;
              return row;
            } else if (operation === 'create') {
              a.data = { ...(a.data ?? {}), tenantId };
            } else if (operation === 'createMany') {
              const rows = Array.isArray(a.data) ? a.data : [a.data];
              a.data = rows.map((r: any) => ({ ...r, tenantId }));
            } else if (['update', 'updateMany', 'delete', 'deleteMany', 'upsert'].includes(operation)) {
              a.where = { ...(a.where ?? {}), tenantId };
              if (operation === 'upsert') {
                a.create = { ...(a.create ?? {}), tenantId };
              }
            }
            return query(a);
          },
        },
      },
    });
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}

export type ScopedPrisma = PrismaService['scoped'];
export { Prisma };
