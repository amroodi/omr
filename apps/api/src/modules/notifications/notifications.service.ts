import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { NotificationAudience, Prisma } from '@prisma/client';
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
  /** ACTION (to do; counted on the bell) or ACTIVITY (colleagues' acts, for admins). */
  kind?: 'ACTION' | 'ACTIVITY';
  /** A shared ORG notice for one desk / branch / panel of the organization (unset = everyone there). */
  stage?: string | null;
  branchId?: string | null;
  panel?: 'ENTRY' | 'PROCESS' | null;
  claimId?: string | null;
}

/** Older than this, a notice no longer counts on the bell (it stays in the list). */
const COUNT_DAYS = 60;

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
          kind: input.kind ?? 'ACTION',
          stage: input.stage ?? null,
          branchId: input.branchId ?? null,
          panel: input.panel ?? null,
          claimId: input.claimId ?? null,
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
        await this.notify({ tenantId, audience: 'ORG', recipientId: a.id, title, body, link, sms: false, kind: 'ACTIVITY' });
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
  /**
   * What the caller may see: a بیمه‌گزار their own; an operator what is addressed to them, plus the shared
   * notices of their own desk (and branch, and panel) — an insurer's admin those of every desk.
   */
  private async where(): Promise<Prisma.NotificationWhereInput> {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER') return { tenantId: ctx.tenantId, audience: 'CUSTOMER' as const, recipientId: ctx.actorId };
    // Only staff read the organization's inbox — never the public inquiry's token or a پنل بیمه‌شده sign-in.
    if (ctx?.actorType !== 'ORG_USER' || !ctx.tenantId || !ctx.actorId) throw new ForbiddenException('دسترسی ندارید');
    const db = this.prisma.unscoped();
    const [user, tenant] = await Promise.all([
      db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { desk: true, branchId: true } }),
      db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { kind: true } }),
    ]);
    const admin = (ctx.permissions ?? []).includes('claim:override');
    const branchId = user?.branchId ?? ctx.branchId ?? null;
    const stage = tenant?.kind === 'BROKER' ? 'BROKER' : user?.desk === 'HQ' || user?.desk === 'COUNCIL' || user?.desk === 'BRANCH' ? user.desk : branchId ? 'BRANCH' : 'HQ';
    const shared: Prisma.NotificationWhereInput[] = [{ OR: [{ panel: null }, { panel: ctx.panelMode === 'ENTRY' ? 'ENTRY' : 'PROCESS' }] }];
    if (!admin) {
      shared.push({ OR: [{ stage: null }, { stage }] });
      if (stage === 'BRANCH' && branchId) shared.push({ OR: [{ branchId: null }, { branchId }] });
    }
    return { tenantId: ctx.tenantId, audience: 'ORG' as const, OR: [{ recipientId: ctx.actorId }, { recipientId: null, AND: shared }] };
  }

  /** Read by me: a personal notice by its own flag, a shared one by my read mark (or one read before marks were per user). */
  private readBy(me: string | undefined): Prisma.NotificationWhereInput {
    return { OR: [{ readAt: { not: null } }, ...(me ? [{ reads: { some: { userId: me } } }] : [])] };
  }

  async list() {
    const me = getContext()?.actorId;
    const rows = await this.live(await this.prisma.unscoped().notification.findMany({
      where: await this.where(), orderBy: { createdAt: 'desc' }, take: 120,
      include: me && getContext()?.actorType === 'ORG_USER' ? { reads: { where: { userId: me }, select: { readAt: true } } } : undefined,
    }));
    return rows.slice(0, 80).map((r: any) => ({
      id: r.id, title: r.title, body: r.body, link: r.link, kind: r.kind, claimId: r.claimId,
      readAt: r.readAt ?? r.reads?.[0]?.readAt ?? null, createdAt: toJalali(r.createdAt),
    }));
  }

  async unreadCount() {
    const me = getContext()?.actorId;
    const since = new Date(Date.now() - COUNT_DAYS * 86_400_000);
    const rows = await this.live(await this.prisma.unscoped().notification.findMany({
      where: { AND: [await this.where(), { kind: 'ACTION', createdAt: { gte: since } }, { NOT: this.readBy(me) }] },
      select: { id: true, link: true }, orderBy: { createdAt: 'desc' }, take: 500,
    }));
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

  /** A personal notice is marked on itself; a shared one only for me (my colleagues still see it unread). */
  async markRead(id: string) {
    const db = this.prisma.unscoped();
    const ctx = getContext();
    const n = await db.notification.findFirst({ where: { AND: [{ id }, await this.where()] }, select: { id: true, recipientId: true } });
    if (!n) return { ok: true };
    if (n.recipientId || ctx?.actorType !== 'ORG_USER') await db.notification.update({ where: { id }, data: { readAt: new Date() } });
    else await db.notificationRead.upsert({ where: { notificationId_userId: { notificationId: id, userId: ctx.actorId! } }, update: {}, create: { notificationId: id, userId: ctx.actorId! } });
    return { ok: true };
  }

  async markAllRead(kind?: string) {
    const db = this.prisma.unscoped();
    const ctx = getContext();
    const base = await this.where();
    const k = kind === 'ACTIVITY' || kind === 'ACTION' ? { kind } : {};
    if (ctx?.actorType !== 'ORG_USER') {
      await db.notification.updateMany({ where: { AND: [base, k, { readAt: null }] }, data: { readAt: new Date() } });
      return { ok: true };
    }
    const me = ctx.actorId!;
    await db.notification.updateMany({ where: { AND: [base, k, { recipientId: me, readAt: null }] }, data: { readAt: new Date() } });
    const shared = await db.notification.findMany({ where: { AND: [base, k, { recipientId: null }, { NOT: this.readBy(me) }] }, select: { id: true }, take: 2000 });
    if (shared.length) await db.notificationRead.createMany({ data: shared.map((n) => ({ notificationId: n.id, userId: me })), skipDuplicates: true });
    return { ok: true };
  }
}
