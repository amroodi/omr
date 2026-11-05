import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
  /** Send the companion SMS too (default true). Set false for internal, high-volume ORG oversight. */
  sms?: boolean;
}

// Only staff holding this permission (the «مدیر سازمان» role) receive operator-activity oversight.
const ADMIN_PERMISSION = 'user:manage';

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
    if (input.sms !== false) {
      this.sendSms(input).catch((e) => this.logger.error(`Notification SMS failed: ${String(e)}`));
    }
  }

  /**
   * Oversight feed for an organization's admins: one in-panel notification per active «مدیر سازمان»
   * of the tenant, addressed to them personally (so regular operators don't see it). No SMS — these
   * are frequent, internal activity notes, not action items. The acting user is skipped so an admin is
   * never pinged about their own action. Best-effort: failure must never break the triggering action.
   */
  async notifyOrgAdmins(
    tenantId: string | undefined,
    title: string,
    body: string,
    link = '/org/claims',
    opts: { excludeActorId?: string | null } = {},
  ): Promise<void> {
    if (!tenantId) return;
    try {
      const admins = await this.prisma.unscoped().orgUser.findMany({
        where: { tenantId, isActive: true, role: { permissions: { has: ADMIN_PERMISSION } } },
        select: { id: true },
      });
      for (const a of admins) {
        if (opts.excludeActorId && a.id === opts.excludeActorId) continue;
        await this.notify({ tenantId, audience: 'ORG', recipientId: a.id, title, body, link, sms: false });
      }
    } catch (e) {
      this.logger.error(`Admin-activity notify failed: ${String(e)}`);
    }
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
    // Only staff read the organization's inbox — never the public inquiry's token or a پنل بیمه‌شده sign-in.
    if (ctx?.actorType !== 'ORG_USER' || !ctx.tenantId) throw new ForbiddenException('دسترسی ندارید');
    // org user → the whole-org inbox (recipientId null) PLUS anything addressed to them personally
    // (admin-activity oversight is targeted per-admin via recipientId).
    return { tenantId: ctx?.tenantId, audience: 'ORG' as const, OR: [{ recipientId: null }, { recipientId: ctx?.actorId }] };
  }

  async list() {
    const rows = await this.live(await this.prisma.unscoped().notification.findMany({ where: this.where(), orderBy: { createdAt: 'desc' }, take: 80 }));
    return rows.slice(0, 50).map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, readAt: r.readAt, createdAt: toJalali(r.createdAt) }));
  }

  async unreadCount() {
    const rows = await this.live(await this.prisma.unscoped().notification.findMany({ where: { ...this.where(), readAt: null }, select: { id: true, link: true }, orderBy: { createdAt: 'desc' }, take: 500 }));
    return { count: rows.length };
  }

  /**
   * Without the notices about a case that has since been deleted (or purged): the inbox and its badge
   * follow the cases, so nobody is sent to a case that is no longer there.
   */
  private async live<T extends { link: string | null }>(rows: T[]): Promise<T[]> {
    const idOf = (l: string | null) => l?.match(/\/claims\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? null;
    const ids = [...new Set(rows.map((r) => idOf(r.link)).filter((x): x is string => !!x))];
    if (!ids.length) return rows;
    const alive = new Set((await this.prisma.unscoped().claim.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })).map((c) => c.id));
    return rows.filter((r) => { const id = idOf(r.link); return !id || alive.has(id); });
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
