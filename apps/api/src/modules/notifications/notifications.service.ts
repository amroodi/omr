import { Injectable, Logger } from '@nestjs/common';
import { NotificationAudience } from '@prisma/client';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';
import { SmsService, TenantSmsConfig } from '../auth/sms.service';

export interface NotifyInput {
  tenantId: string;
  audience: NotificationAudience;
  recipientId?: string | null; // required for CUSTOMER (the account id); null = whole-org inbox
  title: string;
  body: string;
  link?: string;
}

/**
 * Central notification bus. Every call records an in-panel notification AND sends the same message
 * by SMS (best-effort) through the relevant organization's own gateway, so recipients know to open
 * their panel. ORG notifications go to the tenant's configured notify number; CUSTOMER notifications
 * go to that بیمه‌گزار's phone. SMS failure never breaks the triggering action.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly sms: SmsService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.prisma.unscoped().notification.create({
        data: {
          tenantId: input.tenantId,
          audience: input.audience,
          recipientId: input.recipientId ?? null,
          title: input.title,
          body: input.body,
          link: input.link ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Notification create failed: ${String(e)}`);
    }
    // SMS is best-effort and must never throw into the caller.
    this.sendSms(input).catch((e) => this.logger.error(`Notification SMS failed: ${String(e)}`));
  }

  private async sendSms(input: NotifyInput): Promise<void> {
    const phone = await this.resolvePhone(input);
    if (!phone) return;
    const msg = `${input.title}\n${input.body}\nسامانه دامون`;
    await this.sms.send(phone, msg, input.tenantId);
  }

  private async resolvePhone(input: NotifyInput): Promise<string | null> {
    const db = this.prisma.unscoped();
    if (input.audience === 'CUSTOMER' && input.recipientId) {
      const acc = await db.customerAccount.findUnique({ where: { id: input.recipientId }, select: { phone: true } });
      return acc?.phone ? this.crypto.decrypt(acc.phone) : null;
    }
    if (input.audience === 'ORG') {
      const t = await db.tenant.findUnique({ where: { id: input.tenantId }, select: { smsConfig: true } });
      if (!t?.smsConfig) return null;
      try { return (JSON.parse(this.crypto.decrypt(t.smsConfig) ?? '{}') as TenantSmsConfig).notifyPhone ?? null; } catch { return null; }
    }
    return null;
  }

  // ── Reads for the panel (current actor) ──
  private where() {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER') return { tenantId: ctx.tenantId, audience: 'CUSTOMER' as const, recipientId: ctx.actorId };
    // org user → the whole-org inbox
    return { tenantId: ctx?.tenantId, audience: 'ORG' as const };
  }

  async list() {
    const rows = await this.prisma.unscoped().notification.findMany({ where: this.where(), orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, readAt: r.readAt, createdAt: toJalali(r.createdAt) }));
  }

  async unreadCount() {
    const count = await this.prisma.unscoped().notification.count({ where: { ...this.where(), readAt: null } });
    return { count };
  }

  async markRead(id: string) {
    await this.prisma.unscoped().notification.updateMany({ where: { id, ...this.where() }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead() {
    await this.prisma.unscoped().notification.updateMany({ where: { ...this.where(), readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
