import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toLocalMobile } from './sms/sms-driver';

/**
 * «شاهکار» connection settings (encrypted in PlatformConfig.shahkarConfig). شاهکار itself is reached
 * through a licensed intermediary:
 *  - `finnotech`: GET {baseUrl}/facility/v2/clients/{clientId}/shahkar/verify?nationalCode=…&mobile=…
 *    with `Authorization: Bearer {token}`; the answer carries `result.isValid`.
 *  - `generic`: POST {baseUrl} with JSON `{ nationalCode, mobile }` and `Authorization: Bearer {token}`;
 *    the answer carries `matched` / `isValid` / `result.isValid` (true = same person).
 */
export interface ShahkarConfig {
  provider: 'finnotech' | 'generic';
  baseUrl: string;
  clientId?: string;
  token?: string;
}

const PLATFORM_ID = 'platform';

/**
 * Checks that a کد ملی and a mobile number belong to the same person (سامانهٔ شاهکار). Switched on and
 * off by the super admin only; while off, nothing is checked and an operator's approval is enough.
 */
@Injectable()
export class ShahkarService {
  private readonly logger = new Logger(ShahkarService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
  ) {}

  private async row() {
    return this.prisma.unscoped().platformConfig.findUnique({ where: { id: PLATFORM_ID }, select: { shahkarEnabled: true, shahkarConfig: true } });
  }

  async enabled(): Promise<boolean> {
    return !!(await this.row())?.shahkarEnabled;
  }

  async config(): Promise<ShahkarConfig | null> {
    const r = await this.row();
    if (!r?.shahkarConfig) return null;
    try { return JSON.parse(this.crypto.decrypt(r.shahkarConfig) ?? 'null') as ShahkarConfig; } catch { return null; }
  }

  /** Super admin view: switch + settings, without the secret. */
  async settings() {
    const r = await this.row();
    const c = await this.config();
    return { enabled: !!r?.shahkarEnabled, configured: !!c?.baseUrl, provider: c?.provider ?? 'finnotech', baseUrl: c?.baseUrl ?? '', clientId: c?.clientId ?? '', hasToken: !!c?.token };
  }

  async save(input: { enabled?: boolean; provider?: string; baseUrl?: string; clientId?: string; token?: string }) {
    const cur = (await this.config()) ?? { provider: 'finnotech', baseUrl: '' } as ShahkarConfig;
    const next: ShahkarConfig = {
      provider: input.provider === 'generic' ? 'generic' : input.provider === 'finnotech' ? 'finnotech' : cur.provider,
      baseUrl: input.baseUrl !== undefined ? input.baseUrl.trim().replace(/\/+$/, '') : cur.baseUrl,
      clientId: input.clientId !== undefined ? input.clientId.trim() : cur.clientId,
      token: input.token ? input.token.trim() : cur.token, // empty = keep the stored secret
    };
    if (next.baseUrl && !/^https:\/\//.test(next.baseUrl)) throw new BadRequestException('نشانی سرویس شاهکار باید با https:// شروع شود');
    const data = {
      ...(input.enabled !== undefined ? { shahkarEnabled: input.enabled } : {}),
      shahkarConfig: this.crypto.encrypt(JSON.stringify(next)),
    };
    await this.prisma.unscoped().platformConfig.upsert({ where: { id: PLATFORM_ID }, update: data, create: { id: PLATFORM_ID, ...data } });
    return this.settings();
  }

  /**
   * Throws when شاهکار is on and says the کد ملی and mobile are not the same person. Returns true when it
   * confirmed them, false when the check is off (nothing was asked).
   */
  async assertMatch(nationalCode: string, phone: string): Promise<boolean> {
    if (!(await this.enabled())) return false;
    const ok = await this.match(nationalCode, phone);
    if (!ok) throw new BadRequestException('کد ملی و شمارهٔ همراه متعلق به یک نفر نیستند (استعلام شاهکار). شماره‌ای را وارد کنید که به نام خود شماست.');
    return true;
  }

  /** Ask شاهکار (via the configured provider). Unreachable / unconfigured = a clear 503, never a pass. */
  async match(nationalCode: string, phone: string): Promise<boolean> {
    const c = await this.config();
    if (!c?.baseUrl || !c.token) throw new ServiceUnavailableException('استعلام شاهکار فعال است ولی تنظیم نشده؛ با پشتیبانی سامانه تماس بگیرید.');
    const nid = nationalCode.trim();
    const mobile = toLocalMobile(phone);
    try {
      let body: any;
      if (c.provider === 'finnotech') {
        const url = `${c.baseUrl}/facility/v2/clients/${encodeURIComponent(c.clientId ?? '')}/shahkar/verify?nationalCode=${nid}&mobile=${mobile}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        body = await r.json().catch(() => null);
        if (!r.ok && !body?.result) throw new Error(`HTTP ${r.status}`);
      } else {
        const r = await fetch(c.baseUrl, {
          method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ nationalCode: nid, mobile }), signal: AbortSignal.timeout(15000),
        });
        body = await r.json().catch(() => null);
        if (!r.ok && body == null) throw new Error(`HTTP ${r.status}`);
      }
      const v = body?.result?.isValid ?? body?.isValid ?? body?.matched ?? body?.result?.matched;
      return v === true || v === 'true';
    } catch (e) {
      this.logger.error(`Shahkar check failed: ${String(e)}`);
      throw new ServiceUnavailableException('سامانهٔ شاهکار در دسترس نیست؛ چند دقیقه بعد دوباره تلاش کنید.');
    }
  }
}
