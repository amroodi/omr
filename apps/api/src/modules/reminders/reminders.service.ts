import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { SmsService } from '../auth/sms.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ReminderInput { assigneeId?: string; title: string; note?: string; dueAt: string; claimId?: string; sms?: boolean }

/**
 * «یادآور»: an operator reminds themself or a colleague of the same organization to do something at a
 * time (optionally about a case). When it falls due the assignee gets an in-panel notification and —
 * if the reminder asks for it, the org allows reminder SMS (تنظیمات سازمان) and the assignee has a
 * mobile on their user — an SMS too, so they're reminded even when they're not on the system.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
  ) {}

  onModuleInit() {
    // Check once a minute for reminders that fell due (single API process; `firedAt` keeps it once-only).
    this.timer = setInterval(() => { this.fireDue().catch((e) => this.logger.error(`Reminder sweep failed: ${String(e)}`)); }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private me() {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER' || !ctx.actorId) throw new ForbiddenException('فقط برای کاربران سازمان');
    return { tenantId: getTenantIdOrThrow(), userId: ctx.actorId };
  }

  /** Colleagues one can remind (active users of the same org). */
  async colleagues() {
    const { tenantId, userId } = this.me();
    const [users, t] = await Promise.all([
      this.prisma.unscoped().orgUser.findMany({ where: { tenantId, isActive: true }, orderBy: { displayName: 'asc' }, select: { id: true, displayName: true, username: true, phone: true } }),
      this.prisma.unscoped().tenant.findUnique({ where: { id: tenantId }, select: { reminderSms: true } }),
    ]);
    return {
      smsAllowed: !!t?.reminderSms,
      users: users.map((u) => ({ id: u.id, name: u.displayName || u.username, me: u.id === userId, hasPhone: !!u.phone })),
    };
  }

  async create(input: ReminderInput) {
    const { tenantId, userId } = this.me();
    const db = this.prisma.unscoped();
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('عنوان یادآور را بنویسید');
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException('زمان یادآوری نامعتبر است');
    if (dueAt.getTime() < Date.now() - 60_000) throw new BadRequestException('زمان یادآوری گذشته است');
    const assigneeId = input.assigneeId || userId;
    const who = await db.orgUser.findFirst({ where: { id: assigneeId, tenantId, isActive: true }, select: { id: true } });
    if (!who) throw new BadRequestException('کاربر انتخاب‌شده در سازمان شما نیست');
    if (input.claimId) {
      const c = await db.claim.findFirst({ where: { id: input.claimId, OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }] }, select: { id: true } });
      if (!c) throw new BadRequestException('پرونده یافت نشد');
    }
    const r = await db.reminder.create({
      data: { tenantId, createdById: userId, assigneeId, claimId: input.claimId ?? null, title: title.slice(0, 200), note: input.note?.trim().slice(0, 1000) || null, dueAt, sms: !!input.sms },
    });
    await this.audit.record({ action: AuditAction.CREATE, tenantId, targetType: 'Reminder', targetId: r.id, metadata: { assigneeId, dueAt: dueAt.toISOString(), sms: !!input.sms } });
    if (assigneeId !== userId) {
      await this.notifications.notify({ tenantId, audience: 'ORG', recipientId: assigneeId, title: 'یادآور تازه برای شما', body: `«${title}» — ${toJalali(dueAt, true)}`, link: '/org/reminders', sms: false });
    }
    return this.view(r, userId);
  }

  /** My reminders (to me) and the ones I set for others. */
  async list() {
    const { tenantId, userId } = this.me();
    const rows = await this.prisma.unscoped().reminder.findMany({
      where: { tenantId, OR: [{ assigneeId: userId }, { createdById: userId }] },
      orderBy: [{ doneAt: { sort: 'asc', nulls: 'first' } }, { dueAt: 'asc' }], take: 300,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.assigneeId, r.createdById]))];
    const claimIds = [...new Set(rows.map((r) => r.claimId).filter((x): x is string => !!x))];
    const [users, claims] = await Promise.all([
      this.prisma.unscoped().orgUser.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } }),
      claimIds.length ? this.prisma.unscoped().claim.findMany({ where: { id: { in: claimIds } }, select: { id: true, claimNumber: true } }) : [],
    ]);
    const name = new Map(users.map((u) => [u.id, u.displayName || u.username]));
    const num = new Map(claims.map((c) => [c.id, c.claimNumber]));
    return rows.map((r) => ({ ...this.view(r, userId), assignee: name.get(r.assigneeId) ?? '—', createdBy: name.get(r.createdById) ?? '—', claimNumber: r.claimId ? num.get(r.claimId) ?? null : null }));
  }

  private view(r: any, userId: string) {
    return {
      id: r.id, title: r.title, note: r.note, claimId: r.claimId, sms: r.sms,
      dueAt: r.dueAt.toISOString(), dueAtFa: toJalali(r.dueAt, true), due: r.dueAt.getTime() <= Date.now(),
      done: !!r.doneAt, smsSent: !!r.smsSentAt, mine: r.assigneeId === userId, byMe: r.createdById === userId,
    };
  }

  async setDone(id: string, done: boolean) {
    const { tenantId, userId } = this.me();
    const r = await this.prisma.unscoped().reminder.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('یادآور یافت نشد');
    if (r.assigneeId !== userId && r.createdById !== userId) throw new ForbiddenException('این یادآور مربوط به شما نیست');
    await this.prisma.unscoped().reminder.update({ where: { id }, data: { doneAt: done ? new Date() : null } });
    return { ok: true };
  }

  async remove(id: string) {
    const { tenantId, userId } = this.me();
    const r = await this.prisma.unscoped().reminder.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('یادآور یافت نشد');
    if (r.createdById !== userId) throw new ForbiddenException('فقط ثبت‌کنندهٔ یادآور می‌تواند آن را حذف کند');
    await this.prisma.unscoped().reminder.delete({ where: { id } });
    return { ok: true };
  }

  /** Due reminders → in-panel notification to the assignee (+ SMS when asked and allowed). */
  async fireDue() {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.prisma.unscoped();
      const due = await db.reminder.findMany({ where: { firedAt: null, doneAt: null, dueAt: { lte: new Date() } }, take: 200, orderBy: { dueAt: 'asc' } });
      for (const r of due) {
        // Claim the row first so a slow SMS can't make the next sweep send it twice.
        const claimed = await db.reminder.updateMany({ where: { id: r.id, firedAt: null }, data: { firedAt: new Date() } });
        if (!claimed.count) continue;
        const link = r.claimId ? `/org/claims/${r.claimId}` : '/org/reminders';
        await this.notifications.notify({ tenantId: r.tenantId, audience: 'ORG', recipientId: r.assigneeId, title: `یادآور: ${r.title}`, body: r.note || 'زمان انجام این کار فرا رسیده است.', link, sms: false });
        if (!r.sms) continue;
        const [t, u] = await Promise.all([
          db.tenant.findUnique({ where: { id: r.tenantId }, select: { reminderSms: true } }),
          db.orgUser.findUnique({ where: { id: r.assigneeId }, select: { phone: true } }),
        ]);
        const phone = u?.phone ? this.crypto.decrypt(u.phone) : null;
        if (!t?.reminderSms || !phone) continue;
        try {
          await this.sms.send(phone, `یادآور: ${r.title}${r.note ? `\n${r.note}` : ''}\nسامانه دامون`, r.tenantId);
          await db.reminder.update({ where: { id: r.id }, data: { smsSentAt: new Date() } });
        } catch (e) {
          this.logger.error(`Reminder SMS failed (${r.id}): ${String(e)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
