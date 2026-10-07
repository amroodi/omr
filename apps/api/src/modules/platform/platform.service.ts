import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';
import { SMS_DRIVERS, SmsService, TenantSmsConfig } from '../auth/sms.service';

const SECRET_FIELDS: (keyof TenantSmsConfig)[] = ['apiKey', 'password'];
const PLATFORM_ID = 'platform';

/** Super-admin-managed host platform settings: the platform SMS gateway (Damuon's Magfa today). */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  private db() {
    return this.prisma.unscoped().platformConfig;
  }

  private async load(): Promise<TenantSmsConfig | null> {
    const pc = await this.db().findUnique({ where: { id: PLATFORM_ID }, select: { smsConfig: true } });
    if (!pc?.smsConfig) return null;
    try { return JSON.parse(this.crypto.decrypt(pc.smsConfig) ?? '{}') as TenantSmsConfig; } catch { return null; }
  }

  async getSmsConfig() {
    const cfg = await this.load();
    return {
      drivers: SMS_DRIVERS,
      configured: !!cfg,
      driver: cfg?.driver ?? '',
      sender: cfg?.sender ?? '',
      username: cfg?.username ?? '',
      domain: cfg?.domain ?? '',
      otpPattern: cfg?.otpPattern ?? '',
      otpTemplateId: cfg?.otpTemplateId ?? '',
      hasApiKey: !!cfg?.apiKey,
      hasPassword: !!cfg?.password,
    };
  }

  async setSmsConfig(dto: Partial<TenantSmsConfig> & { driver: string }) {
    if (!SMS_DRIVERS.includes(dto.driver)) throw new BadRequestException('درایور پیامک نامعتبر است');
    const existing = (await this.load()) ?? ({} as TenantSmsConfig);
    const merged: TenantSmsConfig = { ...existing, ...this.nonEmpty(dto), driver: dto.driver } as TenantSmsConfig;
    const enc = this.crypto.encrypt(JSON.stringify(merged))!;
    await this.db().upsert({ where: { id: PLATFORM_ID }, update: { smsConfig: enc }, create: { id: PLATFORM_ID, smsConfig: enc } });
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', targetType: 'PlatformSmsConfig', metadata: { driver: dto.driver } });
    return this.getSmsConfig();
  }

  async testSms(phone: string) {
    const cfg = await this.load();
    if (!cfg) throw new BadRequestException('ابتدا درگاه پیامک سکو را ذخیره کنید');
    if (!phone) throw new BadRequestException('شماره موبایل مقصد را وارد کنید');
    try {
      await this.sms.buildDriver(cfg).send(phone, 'پیام آزمایشی درگاه پیامک سکو (بیمس) — با موفقیت ارسال شد.');
      return { ok: true };
    } catch (e) {
      throw new BadRequestException(`ارسال آزمایشی ناموفق بود: ${String((e as Error).message)}`);
    }
  }

  /** Organizations and their platform-gateway status (for the super-admin approvals view). */
  async smsRequests() {
    const rows = await this.prisma.unscoped().tenant.findMany({
      where: { OR: [{ smsUsePlatformRequested: true }, { smsUsePlatform: true }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, smsUsePlatform: true, smsUsePlatformRequested: true },
    });
    return rows;
  }

  async setTenantPlatformSms(tenantId: string, enabled: boolean) {
    await this.prisma.unscoped().tenant.update({ where: { id: tenantId }, data: { smsUsePlatform: enabled, smsUsePlatformRequested: false } });
    await this.audit.record({ action: AuditAction.EDIT, actorType: 'SUPER_ADMIN', tenantId, targetType: 'Tenant', targetId: tenantId, metadata: { smsUsePlatform: enabled } });
    return { ok: true };
  }

  private nonEmpty(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (SECRET_FIELDS.includes(k as keyof TenantSmsConfig) && String(v).trim() === '') continue;
      out[k] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  }
}
