import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { SMS_DRIVERS, SmsService, TenantSmsConfig } from '../auth/sms.service';

export type AssetKind = 'logo' | 'favicon' | 'font';

// Which config fields each driver needs — drives the panel form and server-side validation.
const SECRET_FIELDS: (keyof TenantSmsConfig)[] = ['apiKey', 'password'];

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']);
const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const KEY_FIELD: Record<AssetKind, 'logoKey' | 'faviconKey' | 'fontKey'> = {
  logo: 'logoKey',
  favicon: 'faviconKey',
  font: 'fontKey',
};

interface UpdateSettings {
  name?: string;
  primaryColor?: string;
  contactHeader?: string;
  fontFamily?: string;
  noticeDays?: number;
  embedOrigins?: string[];
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  private tenantDb() {
    return this.prisma.unscoped().tenant; // Tenant has no tenantId column; query by id explicitly.
  }

  async getSettings() {
    const id = getTenantIdOrThrow();
    const t = await this.tenantDb().findUnique({ where: { id } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    return {
      name: t.name,
      slug: t.slug,
      primaryColor: t.primaryColor,
      contactHeader: t.contactHeader,
      fontFamily: t.fontFamily,
      noticeDays: t.noticeDays,
      embedOrigins: t.embedOrigins,
      hasLogo: !!t.logoKey,
      hasFavicon: !!t.faviconKey,
      hasCustomFont: !!t.fontKey,
      carrier: { configured: !!t.carrierConfig },
    };
  }

  async updateSettings(dto: UpdateSettings) {
    const id = getTenantIdOrThrow();
    const t = await this.tenantDb().update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.primaryColor ? { primaryColor: dto.primaryColor } : {}),
        ...(dto.contactHeader !== undefined ? { contactHeader: dto.contactHeader } : {}),
        ...(dto.fontFamily ? { fontFamily: dto.fontFamily.trim() } : {}),
        ...(dto.noticeDays !== undefined ? { noticeDays: dto.noticeDays } : {}),
        ...(dto.embedOrigins !== undefined ? { embedOrigins: dto.embedOrigins } : {}),
      },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'TenantBranding', targetId: id, metadata: dto as Record<string, unknown> });
    return this.getSettings();
  }

  // ── Per-tenant SMS gateway ─────────────────────────────────────────────
  private async loadSmsConfig(id: string): Promise<TenantSmsConfig | null> {
    const t = await this.tenantDb().findUnique({ where: { id }, select: { smsConfig: true } });
    if (!t?.smsConfig) return null;
    try { return JSON.parse(this.crypto.decrypt(t.smsConfig) ?? '{}') as TenantSmsConfig; } catch { return null; }
  }

  /** Masked view for the panel: secrets are never returned, only whether they are set. */
  async getSmsConfig() {
    const id = getTenantIdOrThrow();
    const cfg = await this.loadSmsConfig(id);
    const t = await this.tenantDb().findUnique({ where: { id }, select: { smsUsePlatform: true, smsUsePlatformRequested: true } });
    const platform = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { smsConfig: true } });
    return {
      drivers: SMS_DRIVERS,
      configured: !!cfg,
      driver: cfg?.driver ?? '',
      sender: cfg?.sender ?? '',
      username: cfg?.username ?? '',
      domain: cfg?.domain ?? '',
      otpPattern: cfg?.otpPattern ?? '',
      otpTemplateId: cfg?.otpTemplateId ?? '',
      notifyPhone: cfg?.notifyPhone ?? '',
      hasApiKey: !!cfg?.apiKey,
      hasPassword: !!cfg?.password,
      // Platform-gateway fallback status
      usePlatform: !!t?.smsUsePlatform,
      usePlatformRequested: !!t?.smsUsePlatformRequested,
      platformAvailable: !!platform?.smsConfig,
    };
  }

  /** Org asks the super-admin to let it send via the platform gateway (Damuon's Magfa). */
  async requestPlatformSms() {
    const id = getTenantIdOrThrow();
    await this.tenantDb().update({ where: { id }, data: { smsUsePlatformRequested: true } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'TenantSmsConfig', targetId: id, metadata: { requestPlatformSms: true } });
    return this.getSmsConfig();
  }

  /** Save config. Blank secret fields keep the stored value (so the masked form need not resend them). */
  async setSmsConfig(dto: Partial<TenantSmsConfig> & { driver: string }) {
    const id = getTenantIdOrThrow();
    if (!SMS_DRIVERS.includes(dto.driver)) throw new BadRequestException('درایور پیامک نامعتبر است');
    const existing = (await this.loadSmsConfig(id)) ?? ({} as TenantSmsConfig);
    const merged: TenantSmsConfig = { ...existing, ...this.nonEmpty(dto) } as TenantSmsConfig;
    // Blank secrets in the payload must not wipe stored ones; nonEmpty() already dropped blanks.
    merged.driver = dto.driver;
    await this.tenantDb().update({ where: { id }, data: { smsConfig: this.crypto.encrypt(JSON.stringify(merged)) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'TenantSmsConfig', targetId: id, metadata: { driver: dto.driver } });
    return this.getSmsConfig();
  }

  /** Send a one-off test message using the saved config, to verify the gateway works. */
  async testSms(phone: string) {
    const id = getTenantIdOrThrow();
    const cfg = await this.loadSmsConfig(id);
    if (!cfg) throw new BadRequestException('ابتدا درگاه پیامک را ذخیره کنید');
    if (!phone) throw new BadRequestException('شماره موبایل مقصد را وارد کنید');
    try {
      await this.sms.buildDriver(cfg).send(phone, 'پیام آزمایشی سامانه بیمس — درگاه پیامک شما با موفقیت کار می‌کند.');
      return { ok: true };
    } catch (e) {
      throw new BadRequestException(`ارسال آزمایشی ناموفق بود: ${String((e as Error).message)}`);
    }
  }

  private nonEmpty(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (SECRET_FIELDS.includes(k as keyof TenantSmsConfig) && String(v).trim() === '') continue; // keep stored secret
      out[k] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  }

  async uploadAsset(kind: AssetKind, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (kind === 'font') {
      if (!FONT_EXT.test(file.originalname)) throw new BadRequestException('فقط فونت‌های woff2, woff, ttf, otf مجاز است');
    } else if (!IMAGE_MIME.has(file.mimetype)) {
      throw new BadRequestException('فرمت تصویر نامعتبر است');
    }
    const id = getTenantIdOrThrow();
    const storageKey = await this.storage.save(id, file.buffer);
    const mime = kind === 'font' ? fontMime(file.originalname) : file.mimetype;
    await this.tenantDb().update({ where: { id }, data: { [KEY_FIELD[kind]]: pack(storageKey, mime) } });
    await this.audit.record({ action: AuditAction.UPLOAD, targetType: 'TenantAsset', targetId: id, metadata: { kind } });
    return { ok: true, kind };
  }

  /** Read a tenant's branding asset for public display. Decrypts on the way out. */
  async getAsset(kind: AssetKind): Promise<{ buffer: Buffer; mime: string }> {
    const id = getTenantIdOrThrow();
    const t = await this.tenantDb().findUnique({ where: { id }, select: { [KEY_FIELD[kind]]: true } as any });
    const packed = (t as any)?.[KEY_FIELD[kind]] as string | null;
    if (!packed) throw new NotFoundException('asset not set');
    const { key, mime } = unpack(packed);
    return { buffer: await this.storage.read(key), mime };
  }

  /** Public branding for theming the frontend (resolved via tenant slug). */
  async getPublicBranding() {
    const id = getTenantIdOrThrow();
    const t = await this.tenantDb().findUnique({ where: { id } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    return {
      name: t.name,
      primaryColor: t.primaryColor,
      fontFamily: t.fontFamily,
      logoUrl: t.logoKey ? '/tenant/assets/logo' : null,
      faviconUrl: t.faviconKey ? '/tenant/assets/favicon' : null,
      fontUrl: t.fontKey ? '/tenant/assets/font' : null,
    };
  }

  async setCarrierConfig(config: Record<string, unknown>) {
    const id = getTenantIdOrThrow();
    await this.tenantDb().update({ where: { id }, data: { carrierConfig: this.crypto.encrypt(JSON.stringify(config)) } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'TenantCarrierConfig', targetId: id, actorId: getContext()?.actorId });
    return { ok: true, configured: true };
  }
}

function pack(key: string, mime: string): string {
  return `${key}|${mime}`;
}
function unpack(s: string): { key: string; mime: string } {
  const i = s.lastIndexOf('|');
  return i < 0 ? { key: s, mime: 'application/octet-stream' } : { key: s.slice(0, i), mime: s.slice(i + 1) };
}
function fontMime(name: string): string {
  if (/\.woff2$/i.test(name)) return 'font/woff2';
  if (/\.woff$/i.test(name)) return 'font/woff';
  if (/\.ttf$/i.test(name)) return 'font/ttf';
  if (/\.otf$/i.test(name)) return 'font/otf';
  return 'application/octet-stream';
}
