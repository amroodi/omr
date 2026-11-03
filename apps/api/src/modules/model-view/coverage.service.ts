import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { fromJalali, toAsciiDigits } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Coverage inquiry from the insurer's issuing system (فن‌آوران, behind Sinad). One connection per insurer,
 * OFF until Super Admin fills it in and switches it on (Super Admin › «اتصال فن‌آوران»). While it is off
 * nothing here runs for that insurer.
 *
 * The panel-1 filing form asks it first, with the insured's کد ملی: is this person — and their بیمه‌نامه
 * and its period — defined at فن‌آوران? If not, the case can't be filed for a payout (`onUncovered`).
 * If the service is down the case is filed, marked NOT_CHECKED and re-checked here automatically, unless
 * Super Admin chose to refuse filing while it's down (`onUnavailable`).
 */
export interface CoverageFields {
  valid: string; // «معتبر»
  firstName: string; // «نام»
  lastName: string; // «نام خانوادگی»
  insuredCode: string; // «کد رایانه»
  birthYear: string; // «سال تولد»
  nationalCode: string; // «کد ملی» — picks the person's own row when the reply lists a family
  policyNumber: string; // their بیمه‌نامه number (empty = not in the reply)
  policyStart: string;
  policyEnd: string;
}
export interface CoverageConfig {
  enabled: boolean;
  url: string;
  method: 'GET' | 'POST';
  nationalCodeParam: string; // query parameter (GET) / body field (POST) of the کد ملی
  extraParams: string; // fixed values the service needs, one «name=value» per line (e.g. insurer code)
  authHeader: string; // e.g. Authorization
  secret: string | null; // ENCRYPTED value of that header
  timeoutSec: number;
  perMinute: number; // their rate limit: re-checks per minute
  rowsPath: string; // where the rows are in the reply, e.g. «data» or «result.items»; empty = found automatically
  fields: CoverageFields;
  validValues: string; // values of the «معتبر» column that mean covered, comma-separated
  onUncovered: 'BLOCK' | 'WARN'; // person not found / not covered: refuse the case, or only warn
  onUnavailable: 'ALLOW' | 'BLOCK'; // service down: file and re-check later, or refuse until it's back
  checkPeriod: boolean; // with the policy period in the reply, the event date must fall inside it
  autoFill: boolean; // fill the insured's name on the form from the reply
  matchPolicy: boolean; // select the company's بیمه‌نامه whose number the reply gives
}
export type CoverageStatus = 'VALID' | 'INVALID' | 'NOT_FOUND' | 'NOT_CHECKED';
export interface CoverageResult {
  status: Exclude<CoverageStatus, 'NOT_CHECKED'>;
  person: { firstName: string | null; lastName: string | null; insuredCode: string | null; birthYear: string | null } | null;
  policy: { number: string | null; start: string | null; end: string | null } | null; // ISO dates
  reason?: 'OUT_OF_PERIOD';
}

export const DEFAULT_FIELDS: CoverageFields = {
  valid: 'معتبر', firstName: 'نام', lastName: 'نام خانوادگی', insuredCode: 'کد رایانه', birthYear: 'سال تولد',
  nationalCode: 'کد ملی', policyNumber: '', policyStart: '', policyEnd: '',
};
export const DEFAULT_COVERAGE: CoverageConfig = {
  enabled: false, url: '', method: 'GET', nationalCodeParam: 'nationalCode', extraParams: '', authHeader: 'Authorization', secret: null,
  timeoutSec: 10, perMinute: 6, rowsPath: '', fields: DEFAULT_FIELDS, validValues: 'بله,true,1,معتبر,yes,دارد',
  onUncovered: 'BLOCK', onUnavailable: 'ALLOW', checkPeriod: true, autoFill: true, matchPolicy: true,
};
export const coverageFrom = (v: unknown): CoverageConfig => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<CoverageConfig>;
  return { ...DEFAULT_COVERAGE, ...o, fields: { ...DEFAULT_FIELDS, ...((o.fields && typeof o.fields === 'object' ? o.fields : {}) as Partial<CoverageFields>) } };
};

const norm = (k: string) => k.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();

/** «name=value» lines → pairs (blank lines and lines without «=» are skipped). */
export function parseParams(text: string): [string, string][] {
  return (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()] as [string, string]).filter(([k]) => !!k);
}

/** The rows of a reply: at `path` when given, else the reply itself / its «data». */
function rowsOf(body: unknown, path: string): Record<string, unknown>[] {
  let v: any = body;
  if (path.trim()) for (const k of path.trim().split('.')) v = v == null ? undefined : v[k];
  else v = Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : v?.data ?? v;
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
  return list.filter((r: unknown) => r && typeof r === 'object' && Object.keys(r as object).length) as Record<string, unknown>[];
}

/** A date from their reply: Jalali (۱۴۰۵/۰۵/۰۱) or ISO. */
function dateOf(v: string | null): string | null {
  if (!v) return null;
  const s = toAsciiDigits(v).trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  try {
    if (m && Number(m[1]) < 1700) return fromJalali(`${m[1]}/${m[2]}/${m[3]}`).toISOString();
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

/** One person from their list (columns named as Super Admin set them: «نام», «نام خانوادگی», «معتبر», …). */
export function readCoverage(body: unknown, cfg: CoverageConfig = DEFAULT_COVERAGE, nationalCode?: string): CoverageResult {
  const rows = rowsOf(body, cfg.rowsPath);
  if (!rows.length) return { status: 'NOT_FOUND', person: null, policy: null };
  const cols = (r: Record<string, unknown>) => new Map(Object.entries(r).map(([k, v]) => [norm(k), v]));
  const f = cfg.fields;
  const nidCol = f.nationalCode ? norm(f.nationalCode) : '';
  const digits = (v: unknown) => toAsciiDigits(String(v ?? '')).replace(/\D/g, '');
  // The reply may list a whole family: take this person's own row when it names کد ملی.
  const row = cols((nationalCode && nidCol && rows.find((r) => digits(cols(r).get(nidCol)) === nationalCode)) || rows[0]);
  const str = (k: string) => { if (!k) return null; const v = row.get(norm(k)); return v == null || v === '' ? null : String(v); };
  if (!row.has(norm(f.valid))) throw new Error(`پاسخ سرویس ستون «${f.valid}» ندارد`);
  const yes = new Set(cfg.validValues.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const number = str(f.policyNumber); const start = dateOf(str(f.policyStart)); const end = dateOf(str(f.policyEnd));
  return {
    status: yes.has(String(row.get(norm(f.valid))).trim().toLowerCase()) ? 'VALID' : 'INVALID',
    person: { firstName: str(f.firstName), lastName: str(f.lastName), insuredCode: str(f.insuredCode), birthYear: str(f.birthYear) },
    policy: number || start || end ? { number, start, end } : null,
  };
}

/** A covered person whose policy period (from the reply) doesn't hold the event date isn't covered for it. */
export function judgeCoverage(r: CoverageResult, cfg: CoverageConfig, eventDate?: Date | null): CoverageResult {
  if (r.status !== 'VALID' || !cfg.checkPeriod || !eventDate || !r.policy) return r;
  const t = eventDate.getTime();
  const before = r.policy.start && t < new Date(r.policy.start).getTime();
  const after = r.policy.end && t > new Date(r.policy.end).getTime() + 86_399_999; // the whole last day
  return before || after ? { ...r, status: 'INVALID', reason: 'OUT_OF_PERIOD' } : r;
}

export function coverageMessage(r: { status: CoverageStatus; reason?: string }): string {
  if (r.reason === 'OUT_OF_PERIOD') return 'تاریخ وقوع خارج از بازهٔ بیمه‌نامهٔ این فرد در سامانهٔ بیمه‌گر (فن‌آوران) است؛ پرونده برای پرداخت خسارت ثبت نمی‌شود.';
  if (r.status === 'NOT_FOUND') return 'این کد ملی و بیمه‌نامهٔ آن در سامانهٔ بیمه‌گر (فن‌آوران) تعریف نشده است؛ پرونده برای پرداخت خسارت ثبت نمی‌شود.';
  if (r.status === 'INVALID') return 'پوشش بیمه‌ای این فرد در سامانهٔ بیمه‌گر (فن‌آوران) معتبر نیست؛ پرونده برای پرداخت خسارت ثبت نمی‌شود.';
  if (r.status === 'NOT_CHECKED') return 'سامانهٔ بیمه‌گر (فن‌آوران) در دسترس نیست.';
  return 'پوشش بیمه‌ای معتبر است.';
}

/** What the filing form gets back (and the server enforces again on «ثبت پرونده»). */
export interface CoverageAnswer {
  status: CoverageStatus;
  person: CoverageResult['person'];
  policy: CoverageResult['policy'];
  reason?: string;
  blocked: boolean; // this answer stops the case from being filed
  message: string;
  autoFill: boolean;
  matchPolicy: boolean;
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

  /** Call their service; the HTTP status and the parsed reply. Throws when it can't be reached. */
  async call(cfg: CoverageConfig, nationalCode: string): Promise<{ httpStatus: number; body: unknown }> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const secret = cfg.secret ? this.crypto.decrypt(cfg.secret) : null;
    if (secret) headers[cfg.authHeader] = secret;
    const extra = parseParams(cfg.extraParams);
    const signal = AbortSignal.timeout(Math.min(60, Math.max(2, cfg.timeoutSec || 10)) * 1000);
    let res: Response;
    if (cfg.method === 'POST') {
      headers['content-type'] = 'application/json';
      res = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify({ ...Object.fromEntries(extra), [cfg.nationalCodeParam]: nationalCode }), signal, redirect: 'error' });
    } else {
      const url = new URL(cfg.url);
      for (const [k, v] of extra) url.searchParams.set(k, v);
      url.searchParams.set(cfg.nationalCodeParam, nationalCode);
      res = await fetch(url, { headers, signal, redirect: 'error' });
    }
    const text = await res.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: kept as text for the test screen */ }
    return { httpStatus: res.status, body };
  }

  /** Ask the service; throws when it can't answer (down, timeout, unexpected reply). */
  async ask(cfg: CoverageConfig, nationalCode: string): Promise<CoverageResult> {
    const { httpStatus, body } = await this.call(cfg, nationalCode);
    if (httpStatus === 404) return { status: 'NOT_FOUND', person: null, policy: null };
    if (httpStatus < 200 || httpStatus >= 300) throw new Error(`سرویس پاسخ ${httpStatus} داد`);
    if (typeof body === 'string') throw new Error('پاسخ سرویس JSON نیست');
    return readCoverage(body, cfg, nationalCode);
  }

  private answer(cfg: CoverageConfig, r: CoverageResult | null): CoverageAnswer {
    const base = { autoFill: cfg.autoFill, matchPolicy: cfg.matchPolicy };
    if (!r) return { ...base, status: 'NOT_CHECKED', person: null, policy: null, blocked: cfg.onUnavailable === 'BLOCK', message: coverageMessage({ status: 'NOT_CHECKED' }) };
    return { ...base, ...r, blocked: r.status !== 'VALID' && cfg.onUncovered === 'BLOCK', message: coverageMessage(r) };
  }

  /** The check on the filing form: null when this insurer has it off. */
  async lookup(insurerId: string, nationalCode: string, eventDate?: Date | null): Promise<CoverageAnswer | null> {
    const cfg = await this.config(insurerId);
    if (!cfg.enabled || !cfg.url) return null;
    const r = await this.ask(cfg, nationalCode).then((x) => judgeCoverage(x, cfg, eventDate)).catch((e) => {
      this.logger.warn(`coverage ${insurerId}: ${String(e)}`);
      return null;
    });
    return this.answer(cfg, r);
  }

  /**
   * The same check when the case is filed (the form's answer isn't trusted): refuses a person who isn't
   * covered (when set to), and returns the status to record on the new case. null = inquiry off.
   */
  async gate(insurerId: string, nationalCode: string, eventDate: Date | null): Promise<CoverageStatus | null> {
    const a = await this.lookup(insurerId, nationalCode, eventDate);
    if (!a) return null;
    if (a.blocked) {
      if (a.status === 'NOT_CHECKED') throw new ServiceUnavailableException('سامانهٔ بیمه‌گر (فن‌آوران) در دسترس نیست و تا پاسخ آن پرونده ثبت نمی‌شود؛ کمی بعد دوباره تلاش کنید.');
      throw new BadRequestException(a.message);
    }
    return a.status;
  }

  async record(claimId: string, status: CoverageStatus) {
    await this.prisma.unscoped().claim.update({ where: { id: claimId }, data: { coverageStatus: status, coverageCheckedAt: status === 'NOT_CHECKED' ? null : new Date() } });
  }

  /** Cases still NOT_CHECKED: as soon as the service answers they are filled in, at its rate limit. */
  async retrySweep(onlyInsurerId?: string): Promise<{ checked: number }> {
    if (this.busy) return { checked: 0 };
    this.busy = true;
    let checked = 0;
    try {
      const db = this.prisma.unscoped();
      const insurers = await db.tenant.findMany({ where: { kind: 'INSURER', coverageConfig: { not: null as any }, ...(onlyInsurerId ? { id: onlyInsurerId } : {}) }, select: { id: true, coverageConfig: true } });
      for (const t of insurers) {
        const cfg = coverageFrom(t.coverageConfig);
        if (!cfg.enabled || !cfg.url) continue;
        const due = await db.claim.findMany({ where: { insurerTenantId: t.id, coverageStatus: 'NOT_CHECKED', deletedAt: null }, orderBy: { createdAt: 'asc' }, take: Math.max(1, cfg.perMinute), select: { id: true, deceasedNationalCode: true, eventDate: true } });
        for (const c of due) {
          const nid = c.deceasedNationalCode ? this.crypto.decrypt(c.deceasedNationalCode) : null;
          if (!nid) continue;
          try { await this.record(c.id, judgeCoverage(await this.ask(cfg, nid), cfg, c.eventDate).status); checked++; } catch { break; } // still down: try again next minute
        }
      }
    } finally { this.busy = false; }
    return { checked };
  }

  /** Only https in production, so a mistyped address can't send کد ملی in the clear. */
  assertUrl(url: string) {
    let u: URL;
    try { u = new URL(url); } catch { throw new BadRequestException('نشانی سرویس نامعتبر است'); }
    if (u.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || u.protocol !== 'http:')) throw new BadRequestException('نشانی سرویس باید https باشد');
  }
}
