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
  'PolicyholderCompany',
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
 *
 * Row-level security (migration `row_level_security`) is the database's own wall behind these: the
 * scoped client and the claim screens' `party()` client tell PostgreSQL who is asking, per query, and
 * the database itself refuses other organizations' rows. A query with no such setting is unrestricted,
 * exactly as before (inquiry, Super Admin, jobs, scripts).
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
    // Superusers and BYPASSRLS roles skip row-level security: say so loudly (deploy/rls-role.sh).
    try {
      const [r] = await this.$queryRaw<{ bypass: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user`;
      if (String(process.env.ROW_SECURITY ?? '').toLowerCase() === 'off') this.logger.warn('Row-level security switched OFF (ROW_SECURITY=off)');
      else if (r?.bypass) this.logger.warn('Row-level security is NOT enforced: the API connects to PostgreSQL as a superuser/BYPASSRLS role. Connect as a limited role (deploy/rls-role.sh).');
      else this.logger.log('Row-level security enforced');
    } catch { /* informational only */ }
  }

  /** Raw, un-scoped client — cross-tenant. Use only where tenant isolation must be bypassed. */
  unscoped(): PrismaClient {
    return this;
  }

  private partyClient?: PrismaClient;
  private partyReplicaClient?: PrismaClient;

  /**
   * The claim screens' client: like unscoped() (the code applies its own rules), but for a signed-in
   * organization or بیمه‌گزار the database also shows only cases that organization is named on — the
   * brokerage and the insurer of a case both see it and everything under it, nobody else does.
   */
  party(): PrismaClient {
    return (this.partyClient ??= withDbSettings(this, partySettings) as unknown as PrismaClient);
  }

  /** replica() with the same case rule (work desk, search, reports). */
  partyReplica(): PrismaClient {
    return (this.partyReplicaClient ??= withDbSettings(this.replica(), partySettings) as unknown as PrismaClient);
  }

  private replicaClient: PrismaClient | null | undefined;

  /**
   * Read-only client for heavy screens (reports, search, Work Desk queues, audit logs, exports): the
   * read-replica when `DATABASE_REPLICA_URL` is set, otherwise this same primary connection. Never
   * write through it, and don't use it to read back something just written — a replica can lag a
   * moment behind the primary. Un-scoped like unscoped(): callers apply their own tenant filter.
   */
  replica(): PrismaClient {
    if (this.replicaClient === undefined) {
      const url = String(process.env.DATABASE_REPLICA_URL ?? '').trim();
      this.replicaClient = url ? new PrismaClient({ datasourceUrl: url, log: ['warn', 'error'] }) : null;
      if (url) this.logger.log('Read-replica enabled for read-only screens');
    }
    return this.replicaClient ?? this;
  }

  /** For /health: 'off' (no replica configured), 'up' or 'down'. */
  async replicaStatus(): Promise<'off' | 'up' | 'down'> {
    if (!String(process.env.DATABASE_REPLICA_URL ?? '').trim()) return 'off';
    try { await this.replica().$queryRaw`SELECT 1`; return 'up'; } catch { return 'down'; }
  }

  private buildScoped() {
    // The database's settings go innermost, so the tenant filter below runs first and its query()
    // is the one sent inside the settings' transaction.
    return withDbSettings(this, scopedSettings).$extends({
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

/** The case rule applies to a signed-in organization user or بیمه‌گزار (their own organization). */
function partySettings(): Record<string, string> | null {
  const ctx = getContext();
  if (!ctx?.tenantId || (ctx.actorType !== 'ORG_USER' && ctx.actorType !== 'CUSTOMER')) return null;
  return { 'app.claim_party': ctx.tenantId };
}

/** The scoped client: the organization's private tables, plus the case rule for its users. */
function scopedSettings(): Record<string, string> | null {
  const tenantId = getContext()?.tenantId;
  if (!tenantId) return null; // the tenant filter refuses the query anyway
  return { 'app.tenant_id': tenantId, ...(partySettings() ?? {}) };
}

/**
 * Runs every model query of `client` in a short transaction that first sets the given PostgreSQL
 * settings (`set_config(…, true)`: they end with the transaction, so pooled connections never carry
 * them to another request). Row-level security policies read them.
 */
function withDbSettings(client: PrismaClient, settings: () => Record<string, string> | null) {
  // Emergency switch: ROW_SECURITY=off sends no settings, so every rule is open (the code's own
  // checks still apply) — for a restart-only rollback, never as the normal setting.
  if (String(process.env.ROW_SECURITY ?? '').toLowerCase() === 'off') return client.$extends({});
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const s = settings();
          if (!s) return query(args);
          const sets = Object.entries(s).map(([k, v]) => client.$executeRaw`SELECT set_config(${k}, ${v}, true)`);
          const out = await client.$transaction([...sets, query(args)]);
          return out[out.length - 1];
        },
      },
    },
  });
}

export type ScopedPrisma = PrismaService['scoped'];
export { Prisma };
