import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsConfig, SmsDriver } from './sms/sms-driver';
import { ConsoleDriver } from './sms/drivers/console.driver';
import { GhasedakDriver } from './sms/drivers/ghasedak.driver';
import { KavenegarDriver } from './sms/drivers/kavenegar.driver';
import { MagfaDriver } from './sms/drivers/magfa.driver';
import { MagfaSoapDriver } from './sms/drivers/magfa-soap.driver';
import { MelipayamakDriver } from './sms/drivers/melipayamak.driver';
import { SmsIrDriver } from './sms/drivers/smsir.driver';

type DriverFactory = (cfg: SmsConfig) => SmsDriver;

const REGISTRY: Record<string, DriverFactory> = {
  console: (c) => new ConsoleDriver(c),
  magfa: (c) => new MagfaDriver(c),
  'magfa-soap': (c) => new MagfaSoapDriver(c),
  kavenegar: (c) => new KavenegarDriver(c),
  ghasedak: (c) => new GhasedakDriver(c),
  smsir: (c) => new SmsIrDriver(c),
  melipayamak: (c) => new MelipayamakDriver(c),
};

export const SMS_DRIVERS = Object.keys(REGISTRY);

/** Shape of a tenant's stored (encrypted) SMS config. All fields optional except driver. */
export interface TenantSmsConfig {
  driver: string;
  sender?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  domain?: string;
  otpPattern?: string;
  otpTemplateId?: string;
  // Free-text OTP body with a {code} placeholder — must match the operator-approved text for
  // free-text lines (Magfa/Melipayamak), otherwise the operator blocks it (e.g. Magfa status 22).
  otpTemplate?: string;
  notifyPhone?: string; // where the org wants admin notifications (e.g. new signups) sent
}

const DEFAULT_OTP_MESSAGE = (code: string) => `کد تایید سامانه دامون: ${code}\nاین کد را در اختیار دیگران قرار ندهید.`;

/** Build the OTP body: use the org's approved template (replacing {code}) when set, else default. */
function otpMessageFor(tmpl: string | undefined): (code: string) => string {
  const t = tmpl?.trim();
  if (!t) return DEFAULT_OTP_MESSAGE;
  return (code: string) => (/\{code\}/i.test(t) ? t.replace(/\{code\}/gi, code) : `${t}\n${code}`);
}

/**
 * SMS facade. Resolves the provider PER TENANT from the tenant's encrypted smsConfig (set in the
 * org panel); falls back to the env-configured driver when a tenant has none. Construction is
 * tolerant: a bad/absent config never crashes startup or throws at the DI layer — send() throws a
 * plain Error that callers wrap, so OTP endpoints never return a raw 500.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly envDriver: SmsDriver | null;
  private readonly cache = new Map<string, { sig: string; driver: SmsDriver }>(); // tenantId -> driver
  private platformCache: { sig: string; driver: SmsDriver } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
  ) {
    this.envDriver = this.buildFromEnv();
  }

  async send(toPhone: string, message: string, tenantId?: string): Promise<void> {
    const driver = await this.driverFor(tenantId);
    if (!driver) throw new Error('هیچ درگاه پیامکی برای این سازمان پیکربندی نشده است');
    return driver.send(toPhone, message);
  }

  async sendOtp(toPhone: string, code: string, tenantId?: string): Promise<void> {
    const driver = await this.driverFor(tenantId);
    if (!driver) throw new Error('هیچ درگاه پیامکی برای این سازمان پیکربندی نشده است');
    return driver.sendOtp(toPhone, code);
  }

  /** OTP via the HOST/platform gateway (used before a user belongs to any org, e.g. signup). */
  async sendOtpViaPlatform(toPhone: string, code: string): Promise<void> {
    const driver = (await this.platformDriver()) ?? this.envDriver;
    if (!driver) throw new Error('درگاه پیامک سکو پیکربندی نشده است');
    return driver.sendOtp(toPhone, code);
  }

  /** Build a one-off driver from a config object (used by the panel's test-send). */
  buildDriver(cfg: TenantSmsConfig): SmsDriver {
    const factory = REGISTRY[cfg.driver];
    if (!factory) throw new Error(`درایور پیامک پشتیبانی نمی‌شود: ${cfg.driver}`);
    return factory(this.toSmsConfig(cfg));
  }

  private async driverFor(tenantId?: string): Promise<SmsDriver | null> {
    if (tenantId) {
      const t = await this.prisma.unscoped().tenant.findUnique({ where: { id: tenantId }, select: { smsConfig: true, smsUsePlatform: true } });
      if (t?.smsConfig) {
        const cached = this.cache.get(tenantId);
        if (cached && cached.sig === t.smsConfig) return cached.driver;
        try {
          const cfg = JSON.parse(this.crypto.decrypt(t.smsConfig) ?? '{}') as TenantSmsConfig;
          const driver = this.buildDriver(cfg);
          this.cache.set(tenantId, { sig: t.smsConfig, driver });
          return driver;
        } catch (e) {
          this.logger.error(`Tenant ${tenantId} SMS config invalid: ${String(e)}`);
          // fall through
        }
      }
      // No own gateway but approved to use the platform gateway (Damuon's Magfa).
      if (t?.smsUsePlatform) {
        const p = await this.platformDriver();
        if (p) return p;
      }
    }
    return this.envDriver;
  }

  private async platformDriver(): Promise<SmsDriver | null> {
    const pc = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { smsConfig: true } });
    if (!pc?.smsConfig) return null;
    if (this.platformCache && this.platformCache.sig === pc.smsConfig) return this.platformCache.driver;
    try {
      const cfg = JSON.parse(this.crypto.decrypt(pc.smsConfig) ?? '{}') as TenantSmsConfig;
      const driver = this.buildDriver(cfg);
      this.platformCache = { sig: pc.smsConfig, driver };
      return driver;
    } catch (e) {
      this.logger.error(`Platform SMS config invalid: ${String(e)}`);
      return null;
    }
  }

  private buildFromEnv(): SmsDriver | null {
    const driver = this.config.get<string>('SMS_DRIVER', 'console').trim();
    try {
      const cfg: TenantSmsConfig = {
        driver,
        sender: this.config.get<string>('SMS_SENDER', ''),
        apiKey: this.config.get<string>('SMS_API_KEY', ''),
        username: this.config.get<string>('SMS_USERNAME', ''),
        password: this.config.get<string>('SMS_PASSWORD', ''),
        domain: this.config.get<string>('SMS_DOMAIN', ''),
        otpPattern: this.config.get<string>('SMS_OTP_PATTERN', ''),
        otpTemplateId: this.config.get<string>('SMS_OTP_TEMPLATE_ID', ''),
        otpTemplate: this.config.get<string>('SMS_OTP_TEMPLATE', ''),
      };
      const d = this.buildDriver(cfg);
      this.logger.log(`Default SMS provider (env): ${d.name}`);
      return d;
    } catch (e) {
      this.logger.warn(`No usable env SMS driver ("${driver}"): ${String(e)}. Tenants must configure their own.`);
      return null;
    }
  }

  private toSmsConfig(cfg: TenantSmsConfig): SmsConfig {
    return {
      sender: cfg.sender ?? '',
      apiKey: cfg.apiKey ?? '',
      username: cfg.username ?? '',
      password: cfg.password ?? '',
      domain: cfg.domain ?? '',
      otpPattern: cfg.otpPattern ?? '',
      otpTemplateId: cfg.otpTemplateId ?? '',
      otpMessage: otpMessageFor(cfg.otpTemplate),
    };
  }
}
