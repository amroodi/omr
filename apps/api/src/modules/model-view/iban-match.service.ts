import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { fromJalali, toAsciiDigits } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * «تطابق شبا و کد ملی»: does a ذینفع's شبا belong to the کد ملی entered for them? One platform-wide
 * connection to a licensed provider, set up and switched on by Super Admin only (PlatformConfig; the
 * token is encrypted). Operators of panel 1 and 2 ask it from a case's ذینفعان; the بیمه‌گزار and panel 3 don't.
 *
 * The call is described, not hard-coded: where, how it is signed, the field names of کد ملی / شبا / تاریخ
 * تولد, and where the yes/no is in the reply. `PRESETS` fill these in for a known provider.
 */
export interface IbanMatchConfig {
  provider: string; // 'shenasar' | 'generic' (a label for the page)
  url: string;
  method: 'POST' | 'GET';
  authHeader: string; // e.g. Authorization
  authPrefix: string; // e.g. «Bearer »
  token: string | null; // ENCRYPTED
  nationalCodeField: string;
  ibanField: string;
  birthDateField: string; // '' = the provider doesn't take it
  birthDateFormat: 'JALALI' | 'GREGORIAN';
  extraParams: string; // fixed «name=value» lines sent with every call
  matchPath: string; // e.g. data.result
  matchValues: string; // values there that mean «matches», comma-separated
  timeoutSec: number;
}

export const IBAN_PRESETS: Record<string, Partial<IbanMatchConfig>> = {
  // docs.shenasar.ir/service/match-national-iban — reply {"status":1,"data":{"result":"yes"},"code":200}
  shenasar: {
    provider: 'shenasar', url: 'https://api.shenasar.ir/inquiry/match_national_iban', method: 'POST', authHeader: 'Authorization', authPrefix: 'Bearer ',
    nationalCodeField: 'national_code', ibanField: 'iban', birthDateField: '', birthDateFormat: 'JALALI', matchPath: 'data.result', matchValues: 'yes,true,1',
  },
  generic: { provider: 'generic' },
};

export const DEFAULT_IBAN: IbanMatchConfig = {
  provider: 'generic', url: '', method: 'POST', authHeader: 'Authorization', authPrefix: 'Bearer ', token: null,
  nationalCodeField: 'nationalCode', ibanField: 'iban', birthDateField: '', birthDateFormat: 'JALALI', extraParams: '',
  matchPath: 'matched', matchValues: 'yes,true,1', timeoutSec: 15,
};

const PLATFORM_ID = 'platform';
const NAME = /^[\w\-.]*$/;

@Injectable()
export class IbanMatchService {
  private readonly logger = new Logger(IbanMatchService.name);
  constructor(private readonly prisma: PrismaService, private readonly crypto: FieldCryptoService) {}

  private async row() {
    return this.prisma.unscoped().platformConfig.findUnique({ where: { id: PLATFORM_ID }, select: { ibanMatchEnabled: true, ibanMatchConfig: true } });
  }
  private parse(enc: string | null | undefined): IbanMatchConfig {
    if (!enc) return { ...DEFAULT_IBAN };
    try { return { ...DEFAULT_IBAN, ...(JSON.parse(this.crypto.decrypt(enc) ?? '{}') as Partial<IbanMatchConfig>) }; } catch { return { ...DEFAULT_IBAN }; }
  }

  /** On and set up: operators get the «استعلام» button. */
  async isOn(): Promise<boolean> {
    const r = await this.row();
    const c = this.parse(r?.ibanMatchConfig);
    return !!r?.ibanMatchEnabled && !!c.url && !!c.token;
  }

  /** The provider asks for the ذینفع's تاریخ تولد too. */
  async needsBirthDate(): Promise<boolean> {
    return !!this.parse((await this.row())?.ibanMatchConfig).birthDateField;
  }

  /** Super Admin's view (the token is write-only). */
  async settings() {
    const r = await this.row();
    const { token, ...c } = this.parse(r?.ibanMatchConfig);
    return { enabled: !!r?.ibanMatchEnabled, ...c, hasToken: !!token, presets: Object.keys(IBAN_PRESETS) };
  }

  async save(input: Partial<IbanMatchConfig> & { enabled?: boolean; token?: string; clearToken?: boolean }) {
    const r = await this.row();
    const cur = this.parse(r?.ibanMatchConfig);
    const pick = <K extends keyof IbanMatchConfig>(k: K) => (input[k] !== undefined ? input[k] : cur[k]) as IbanMatchConfig[K];
    const next: IbanMatchConfig = {
      provider: pick('provider'), url: String(pick('url') ?? '').trim(), method: pick('method') === 'GET' ? 'GET' : 'POST',
      authHeader: pick('authHeader'), authPrefix: pick('authPrefix') ?? '', nationalCodeField: pick('nationalCodeField'), ibanField: pick('ibanField'),
      birthDateField: pick('birthDateField') ?? '', birthDateFormat: pick('birthDateFormat') === 'GREGORIAN' ? 'GREGORIAN' : 'JALALI', extraParams: pick('extraParams') ?? '',
      matchPath: pick('matchPath'), matchValues: pick('matchValues'), timeoutSec: Math.min(60, Math.max(2, Number(pick('timeoutSec')) || 15)),
      token: input.clearToken ? null : input.token?.trim() ? this.crypto.encrypt(input.token.trim()) : cur.token,
    };
    for (const k of ['authHeader', 'nationalCodeField', 'ibanField', 'birthDateField', 'matchPath'] as const) if (!NAME.test(next[k])) throw new BadRequestException(`«${k}» نامعتبر است`);
    if (next.url) {
      let u: URL; try { u = new URL(next.url); } catch { throw new BadRequestException('نشانی سرویس نامعتبر است'); }
      if (u.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || u.protocol !== 'http:')) throw new BadRequestException('نشانی سرویس باید https باشد');
    }
    const enabled = input.enabled ?? !!r?.ibanMatchEnabled;
    if (enabled && (!next.url || !next.token)) throw new BadRequestException('پیش از فعال‌سازی، نشانی سرویس و توکن را وارد کنید');
    const data = { ibanMatchEnabled: enabled, ibanMatchConfig: this.crypto.encrypt(JSON.stringify(next)) };
    await this.prisma.unscoped().platformConfig.upsert({ where: { id: PLATFORM_ID }, update: data, create: { id: PLATFORM_ID, ...data } });
    return this.settings();
  }

  /** Ask the provider. `matched` true / false; throws 503 when it can't answer (never a pass). */
  async check(nationalCode: string, iban: string, birthDate?: string | null, force = false): Promise<{ matched: boolean; raw?: unknown }> {
    const r = await this.row();
    const c = this.parse(r?.ibanMatchConfig);
    if (!force && !r?.ibanMatchEnabled) throw new BadRequestException('استعلام شبا فعال نیست');
    if (!c.url || !c.token) throw new ServiceUnavailableException('استعلام شبا تنظیم نشده است');
    const nid = toAsciiDigits(nationalCode).trim();
    const sheba = toAsciiDigits(iban).replace(/[\s-]/g, '').toUpperCase();
    if (!/^\d{10}$/.test(nid)) throw new BadRequestException('کد ملی باید ۱۰ رقم باشد');
    if (!/^IR\d{24}$/.test(sheba)) throw new BadRequestException('شماره شبا باید IR و ۲۴ رقم باشد');
    const params: [string, string][] = (c.extraParams ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()] as [string, string]);
    params.push([c.nationalCodeField, nid], [c.ibanField, sheba]);
    if (c.birthDateField) {
      const b = toAsciiDigits(birthDate ?? '').trim();
      if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(b)) throw new BadRequestException('تاریخ تولد ذینفع را وارد کنید');
      params.push([c.birthDateField, c.birthDateFormat === 'GREGORIAN' ? fromJalali(b).toISOString().slice(0, 10) : b]);
    }
    const headers: Record<string, string> = { accept: 'application/json', [c.authHeader]: `${c.authPrefix ?? ''}${this.crypto.decrypt(c.token)}` };
    const signal = AbortSignal.timeout(c.timeoutSec * 1000);
    let body: any;
    try {
      let res: Response;
      if (c.method === 'GET') {
        const u = new URL(c.url); for (const [k, v] of params) u.searchParams.set(k, v);
        res = await fetch(u, { headers, signal, redirect: 'error' });
      } else {
        res = await fetch(c.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(params)), signal, redirect: 'error' });
      }
      body = await res.json().catch(() => null);
      if (!res.ok || body == null) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`IBAN match failed: ${String(e).slice(0, 200)}`);
      throw new ServiceUnavailableException('سرویس استعلام شبا پاسخ نداد؛ کمی بعد دوباره تلاش کنید.');
    }
    let v: any = body;
    for (const k of c.matchPath.split('.').filter(Boolean)) v = v == null ? undefined : v[k];
    if (v === undefined) throw new ServiceUnavailableException('پاسخ سرویس استعلام شبا قابل خواندن نیست');
    const yes = new Set(c.matchValues.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    return { matched: yes.has(String(v).trim().toLowerCase()), ...(force ? { raw: body } : {}) };
  }
}
