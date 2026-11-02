import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Coverage inquiry from the insurer's issuing system (فن‌آوران, behind Sinad). One connection per insurer,
 * OFF until Super Admin fills it in and switches it on. While it is off nothing here runs for that insurer.
 * If the service is down a case is still filed, marked NOT_CHECKED, and re-checked here automatically.
 */
export interface CoverageConfig {
  enabled: boolean;
  url: string;
  nationalCodeParam: string; // query parameter of the کد ملی
  authHeader: string; // e.g. Authorization
  secret: string | null; // ENCRYPTED value of that header
  perMinute: number; // their rate limit: re-checks per minute
}
export type CoverageStatus = 'VALID' | 'INVALID' | 'NOT_FOUND' | 'NOT_CHECKED';
export interface CoverageResult { status: Exclude<CoverageStatus, 'NOT_CHECKED'>; person: { firstName: string | null; lastName: string | null; insuredCode: string | null } | null }

export const DEFAULT_COVERAGE: CoverageConfig = { enabled: false, url: '', nationalCodeParam: 'nationalCode', authHeader: 'Authorization', secret: null, perMinute: 6 };
export const coverageFrom = (v: unknown): CoverageConfig => ({ ...DEFAULT_COVERAGE, ...((v && typeof v === 'object' ? v : {}) as Partial<CoverageConfig>) });

const norm = (k: string) => k.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const YES = new Set(['بله', 'true', '1', 'معتبر', 'yes', 'دارد']);

/** One row of their list (columns as they gave them: «نام», «نام خانوادگی», «کد رایانه», «معتبر», …). */
export function readCoverage(body: unknown): CoverageResult {
  const b = body as any;
  const row = Array.isArray(b) ? b[0] : Array.isArray(b?.data) ? b.data[0] : b?.data ?? b;
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return { status: 'NOT_FOUND', person: null };
  const cols = new Map(Object.entries(row).map(([k, v]) => [norm(k), v]));
  const str = (k: string) => { const v = cols.get(k); return v == null || v === '' ? null : String(v); };
  if (!cols.has('معتبر')) throw new Error('پاسخ سرویس ستون «معتبر» ندارد');
  return {
    status: YES.has(String(cols.get('معتبر')).trim().toLowerCase()) ? 'VALID' : 'INVALID',
    person: { firstName: str('نام'), lastName: str('نام خانوادگی'), insuredCode: str('کد رایانه') },
  };
}

@Injectable()
export class CoverageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoverageService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly prisma: PrismaService, private readonly crypto: FieldCryptoService) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => this.retrySweep().catch((e) => this.logger.error(String(e))), 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async config(insurerId: string): Promise<CoverageConfig> {
    const t = await this.prisma.unscoped().tenant.findUnique({ where: { id: insurerId }, select: { coverageConfig: true } });
    return coverageFrom(t?.coverageConfig);
  }

  /** Ask the service; throws when it can't answer (down, timeout, unexpected reply). */
  async ask(cfg: CoverageConfig, nationalCode: string): Promise<CoverageResult> {
    const url = new URL(cfg.url);
    url.searchParams.set(cfg.nationalCodeParam, nationalCode);
    const headers: Record<string, string> = { accept: 'application/json' };
    const secret = cfg.secret ? this.crypto.decrypt(cfg.secret) : null;
    if (secret) headers[cfg.authHeader] = secret;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (res.status === 404) return { status: 'NOT_FOUND', person: null };
    if (!res.ok) throw new Error(`سرویس پاسخ ${res.status} داد`);
    return readCoverage(await res.json());
  }

  /** The check before filing: null when this insurer has it off; NOT_CHECKED when the service is down. */
  async lookup(insurerId: string, nationalCode: string): Promise<(CoverageResult | { status: 'NOT_CHECKED'; person: null }) | null> {
    const cfg = await this.config(insurerId);
    if (!cfg.enabled || !cfg.url) return null;
    return this.ask(cfg, nationalCode).catch((e) => {
      this.logger.warn(`coverage ${insurerId}: ${String(e)}`);
      return { status: 'NOT_CHECKED' as const, person: null };
    });
  }

  /** A new case: record the answer, or NOT_CHECKED for the sweep to pick up. Never blocks filing. */
  async onFiled(claimId: string, insurerId: string, nationalCode: string) {
    const r = await this.lookup(insurerId, nationalCode).catch(() => null);
    if (r) await this.record(claimId, r.status);
  }

  private async record(claimId: string, status: CoverageStatus) {
    await this.prisma.unscoped().claim.update({ where: { id: claimId }, data: { coverageStatus: status, coverageCheckedAt: status === 'NOT_CHECKED' ? null : new Date() } });
  }

  /** Cases still NOT_CHECKED: as soon as the service answers they are filled in, at its rate limit. */
  async retrySweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      const db = this.prisma.unscoped();
      const insurers = await db.tenant.findMany({ where: { kind: 'INSURER', coverageConfig: { not: null as any } }, select: { id: true, coverageConfig: true } });
      for (const t of insurers) {
        const cfg = coverageFrom(t.coverageConfig);
        if (!cfg.enabled || !cfg.url) continue;
        const due = await db.claim.findMany({ where: { insurerTenantId: t.id, coverageStatus: 'NOT_CHECKED', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: Math.max(1, cfg.perMinute), select: { id: true, deceasedNationalCode: true } });
        for (const c of due) {
          const nid = c.deceasedNationalCode ? this.crypto.decrypt(c.deceasedNationalCode) : null;
          if (!nid) continue;
          try { await this.record(c.id, (await this.ask(cfg, nid)).status); } catch { break; } // still down: try again next minute
        }
      }
    } finally { this.busy = false; }
  }

  /** Only https in production, so a mistyped address can't send کد ملی in the clear. */
  assertUrl(url: string) {
    let u: URL;
    try { u = new URL(url); } catch { throw new BadRequestException('نشانی سرویس نامعتبر است'); }
    if (u.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || u.protocol !== 'http:')) throw new BadRequestException('نشانی سرویس باید https باشد');
  }
}
