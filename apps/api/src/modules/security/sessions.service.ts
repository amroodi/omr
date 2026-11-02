import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, LoginSession } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { deviceLabel, distanceKm, placeOf } from '../../common/device/device';
import { toAsciiDigits, toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext } from '../../common/tenant/tenant-context';
import { SmsService } from '../auth/sms.service';

export type Realm = 'ORG' | 'SUPER' | 'CUSTOMER' | 'INSURED';
export const ALERT_KINDS = ['NEW_DEVICE', 'CONCURRENT', 'IMPOSSIBLE_TRAVEL', 'SHARED_DEVICE', 'OFF_HOURS'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_FA: Record<AlertKind, string> = {
  NEW_DEVICE: 'ورود از دستگاه جدید',
  CONCURRENT: 'فعال هم‌زمان روی دو دستگاه',
  IMPOSSIBLE_TRAVEL: 'ورود از دو مکان دور در زمان کوتاه',
  SHARED_DEVICE: 'یک دستگاه برای چند حساب',
  OFF_HOURS: 'ورود خارج از ساعت کاری',
};
export const REALM_FA: Record<Realm, string> = { INSURED: 'بیمه‌شده', ORG: 'کاربران سازمان‌ها', SUPER: 'مدیر سامانه', CUSTOMER: 'بیمه‌گزار و نمایندگان' };

const ACTIVE_MIN = 15; // «هم‌زمان»: the other session was used within this many minutes
const TRAVEL_HOURS = 3; // compare with the previous sign-in only if it was this recent
const TRAVEL_KMH = 500; // faster than this between two sign-ins = not the same person travelling
const SHARED_DAYS = 30; // «یک دستگاه برای چند حساب» looks back this far
const SMS_PER_HOUR = 30; // cap on alert texts (a burst of alerts must not flood the phone)

interface Live { live: boolean; checkedAt: number; touchedAt: number }

/**
 * «امنیت ورود»: one LoginSession per sign-in (every token carries its id), checks that flag sign-ins that
 * may be someone using another person's account, and SMS alerts to the Super Admin's own numbers.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  // ─────────────────────────── Sign-in ───────────────────────────
  /** Record a sign-in (device, IP, place), run the checks, and return the session id for the token. */
  async start(input: { realm: Realm; actorId: string; actorLabel?: string | null; tenantId?: string | null }): Promise<string> {
    const ctx = getContext();
    const place = placeOf(ctx?.ip);
    const tenant = input.tenantId ? await this.db().tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } }) : null;
    const s = await this.db().loginSession.create({
      data: {
        realm: input.realm, actorId: input.actorId, actorLabel: input.actorLabel ?? null, tenantId: input.tenantId ?? null, tenantName: tenant?.name ?? null,
        deviceId: ctx?.deviceId ?? null, fingerprint: ctx?.fingerprint ?? null, deviceLabel: deviceLabel(ctx?.userAgent), userAgent: ctx?.userAgent ?? null,
        ip: ctx?.ip ?? null, location: place?.label ?? null, lat: place?.lat ?? null, lon: place?.lon ?? null,
      },
    });
    if (ctx) ctx.sessionId = s.id;
    this.live.set(s.id, { live: true, checkedAt: Date.now(), touchedAt: Date.now() });
    try { await this.check(s); } catch (e) { this.logger.error(`Sign-in checks failed: ${String(e)}`); } // never block a sign-in
    return s.id;
  }

  /** Is this session still open? Cached for 30 s; also keeps «last seen» fresh (at most once a minute). */
  async isLive(sid: string): Promise<boolean> {
    const now = Date.now();
    const c = this.live.get(sid);
    if (c && now - c.checkedAt < 30_000) {
      if (c.live && now - c.touchedAt > 60_000) { c.touchedAt = now; this.db().loginSession.updateMany({ where: { id: sid, endedAt: null }, data: { lastSeenAt: new Date() } }).catch(() => {}); }
      return c.live;
    }
    const s = await this.db().loginSession.findUnique({ where: { id: sid }, select: { endedAt: true } });
    const live = !!s && !s.endedAt;
    if (live) await this.db().loginSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } }).catch(() => {});
    this.live.set(sid, { live, checkedAt: now, touchedAt: now });
    if (this.live.size > 5000) this.live.delete(this.live.keys().next().value!); // bounded
    return live;
  }

  /** «خروج» from the panel: the caller's own session ends. */
  async logout() {
    const sid = getContext()?.sessionId;
    if (sid) await this.end(sid, 'LOGOUT');
    return { ok: true };
  }

  async end(sid: string, reason: 'LOGOUT' | 'ADMIN', by?: string | null) {
    const r = await this.db().loginSession.updateMany({ where: { id: sid, endedAt: null }, data: { endedAt: new Date(), endReason: reason, endedBy: by ?? null } });
    this.live.set(sid, { live: false, checkedAt: Date.now(), touchedAt: Date.now() });
    return r.count;
  }

  // ─────────────────────────── Checks ───────────────────────────
  private async check(s: LoginSession) {
    const db = this.db();
    const who = { realm: s.realm, actorId: s.actorId };
    const name = s.actorLabel || 'کاربر';
    const dev = s.deviceLabel || 'دستگاه نامشخص';
    const from = [s.ip, s.location].filter(Boolean).join(' — ') || 'نشانی نامشخص';
    const previous = await db.loginSession.findMany({ where: { ...who, id: { not: s.id } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const alerts: { kind: AlertKind; message: string; details?: Record<string, unknown> }[] = [];

    // 1) a device this account has never used (only once it has some history — the first sign-in isn't news)
    if (previous.length && (s.deviceId || s.fingerprint)) {
      const known = previous.some((p) => (s.deviceId && p.deviceId === s.deviceId) || (s.fingerprint && p.fingerprint === s.fingerprint));
      if (!known) alerts.push({ kind: 'NEW_DEVICE', message: `«${name}» از دستگاهی وارد شد که پیش‌تر استفاده نکرده بود: ${dev}، ${from}` });
    }

    // 2) still active elsewhere, on another device
    const recent = new Date(Date.now() - ACTIVE_MIN * 60_000);
    const other = previous.find((p) => !p.endedAt && p.lastSeenAt >= recent && (s.deviceId && p.deviceId ? p.deviceId !== s.deviceId : p.ip !== s.ip));
    if (other) {
      alerts.push({
        kind: 'CONCURRENT',
        message: `«${name}» هم‌زمان روی دو دستگاه فعال است: ${other.deviceLabel || 'دستگاه نامشخص'} (${other.ip ?? '—'}) و ${dev} (${s.ip ?? '—'})`,
        details: { otherSessionId: other.id },
      });
    }

    // 3) two places too far apart for the time between them
    const last = previous[0];
    if (last && s.lat != null && s.lon != null && last.lat != null && last.lon != null) {
      const hours = Math.max((s.createdAt.getTime() - last.createdAt.getTime()) / 3_600_000, 1 / 60);
      const km = distanceKm({ lat: last.lat, lon: last.lon }, { lat: s.lat, lon: s.lon });
      if (hours <= TRAVEL_HOURS && km > 200 && km / hours > TRAVEL_KMH) {
        alerts.push({
          kind: 'IMPOSSIBLE_TRAVEL',
          message: `«${name}» در ${Math.round(hours * 60)} دقیقه از ${last.location ?? last.ip} به ${s.location ?? s.ip} (${Math.round(km)} کیلومتر) رفت`,
          details: { km: Math.round(km), minutes: Math.round(hours * 60), previousSessionId: last.id },
        });
      }
    }

    // 4) this browser has signed in to other accounts recently (same device id — the fingerprint alone
    //    is too common on identical office PCs to accuse anyone). The Super Admin's own sign-ins don't
    //    count: they sign in to other accounts from their own browser for support and testing.
    if (s.deviceId && s.realm !== 'SUPER') {
      const since = new Date(Date.now() - SHARED_DAYS * 86_400_000);
      const others = await db.loginSession.findMany({
        where: { deviceId: s.deviceId, createdAt: { gte: since }, realm: { not: 'SUPER' }, NOT: { realm: s.realm, actorId: s.actorId } },
        distinct: ['realm', 'actorId'], select: { actorLabel: true, realm: true, actorId: true }, take: 10,
      });
      if (others.length) {
        alerts.push({
          kind: 'SHARED_DEVICE',
          message: `«${name}» از دستگاهی وارد شد که در ${SHARED_DAYS} روز اخیر برای حساب‌های دیگر هم استفاده شده: ${others.map((o) => o.actorLabel || o.actorId).join('، ')}`,
          details: { others },
        });
      }
    }

    // 5) outside working hours (Tehran time; Friday optionally all day)
    const cfg = await this.settingsRow();
    const { hour, friday } = tehranClock(s.createdAt);
    if ((cfg.offHoursFriday && friday) || hour < cfg.workHoursStart || hour >= cfg.workHoursEnd) {
      alerts.push({ kind: 'OFF_HOURS', message: `ورود «${name}» خارج از ساعت کاری (${toJalali(s.createdAt)}): ${dev}، ${from}` });
    }

    for (const a of alerts) await this.raise(s, a, cfg);
  }

  private async raise(s: { id: string; realm: string; actorId: string; actorLabel: string | null }, a: { kind: AlertKind; message: string; details?: Record<string, unknown> }, cfg: SettingsRow) {
    const alert = await this.db().securityAlert.create({
      data: { kind: a.kind, sessionId: s.id, realm: s.realm, actorId: s.actorId, actorLabel: s.actorLabel, message: a.message, details: (a.details ?? undefined) as any },
    });
    const phones = this.phones(cfg);
    const wanted = cfg.securityAlertsSms && phones.length && cfg.securityAlertKinds.includes(a.kind) && cfg.securityAlertRealms.includes(s.realm);
    if (!wanted) return;
    // Same thing about the same account within 6 hours: recorded, but texted once.
    if (!(await this.rateLimit.hit(`secalert:${a.kind}:${s.realm}:${s.actorId}`, 1, 6 * 3600))) return;
    if (!(await this.rateLimit.hit('secalert:sms', SMS_PER_HOUR, 3600))) return;
    let sent = false;
    for (const p of phones) {
      try { await this.sms.sendViaPlatform(p, `امنیت ورود — ${ALERT_FA[a.kind]}\n${a.message}`); sent = true; } catch (e) { this.logger.error(`Security alert SMS failed: ${String(e)}`); }
    }
    if (sent) await this.db().securityAlert.update({ where: { id: alert.id }, data: { smsSent: true } });
  }

  // ─────────────────────────── Super Admin ───────────────────────────
  async sessions(q: { active?: string; actor?: string; realm?: string; device?: string; page?: string }) {
    const db = this.db();
    const page = Math.max(1, Number(q.page) || 1);
    const where: any = {};
    if (q.active === '1') where.endedAt = null;
    if (q.realm) where.realm = q.realm;
    if (q.actor) where.actorId = q.actor;
    if (q.device) where.OR = [{ deviceId: q.device }, { fingerprint: q.device }];
    const [total, rows] = await Promise.all([
      db.loginSession.count({ where }),
      db.loginSession.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip: (page - 1) * 50, take: 50, include: { _count: { select: { alerts: true } } } }),
    ]);
    const nowActive = Date.now() - ACTIVE_MIN * 60_000;
    return {
      total, page,
      items: rows.map((r) => ({
        id: r.id, realm: r.realm, realmLabel: REALM_FA[r.realm as Realm] ?? r.realm, actorId: r.actorId, actorLabel: r.actorLabel, tenantName: r.tenantName,
        deviceId: r.deviceId, fingerprint: r.fingerprint, deviceLabel: r.deviceLabel, userAgent: r.userAgent, ip: r.ip, location: r.location,
        createdAt: toJalali(r.createdAt), lastSeenAt: toJalali(r.lastSeenAt), activeNow: !r.endedAt && r.lastSeenAt.getTime() >= nowActive,
        endedAt: r.endedAt ? toJalali(r.endedAt) : null, endReason: r.endReason, alerts: r._count.alerts,
      })),
    };
  }

  async endByAdmin(sid: string) {
    const by = getContext()?.actorId ?? null;
    const n = await this.end(sid, 'ADMIN', by);
    if (!n) throw new NotFoundException('نشست باز یافت نشد');
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'LoginSession', targetId: sid, metadata: { action: 'end' } });
    return { ok: true };
  }

  /** End every open session of one account (e.g. a password that leaked). */
  async endAllOf(realm: string, actorId: string) {
    const db = this.db();
    const open = await db.loginSession.findMany({ where: { realm, actorId, endedAt: null }, select: { id: true } });
    for (const o of open) await this.end(o.id, 'ADMIN', getContext()?.actorId ?? null);
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'LoginSession', targetId: actorId, metadata: { action: 'end-all', realm, count: open.length } });
    return { ok: true, ended: open.length };
  }

  async alerts(q: { unseen?: string; kind?: string; page?: string }) {
    const db = this.db();
    const page = Math.max(1, Number(q.page) || 1);
    const where: any = {};
    if (q.unseen === '1') where.seenAt = null;
    if (q.kind) where.kind = q.kind;
    const [total, unseen, rows] = await Promise.all([
      db.securityAlert.count({ where }),
      db.securityAlert.count({ where: { seenAt: null } }),
      db.securityAlert.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50, include: { session: { select: { deviceLabel: true, ip: true, location: true, deviceId: true, tenantName: true } } } }),
    ]);
    return {
      total, unseen, page,
      items: rows.map((a) => ({
        id: a.id, kind: a.kind, kindLabel: ALERT_FA[a.kind as AlertKind] ?? a.kind, realm: a.realm, actorId: a.actorId, actorLabel: a.actorLabel,
        message: a.message, smsSent: a.smsSent, seen: !!a.seenAt, createdAt: toJalali(a.createdAt), session: a.session, sessionId: a.sessionId,
      })),
    };
  }

  async markSeen(ids?: string[]) {
    await this.db().securityAlert.updateMany({ where: { seenAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { seenAt: new Date() } });
    return { ok: true };
  }

  // ── Settings ──
  private async settingsRow(): Promise<SettingsRow> {
    const pc = await this.db().platformConfig.upsert({ where: { id: 'platform' }, update: {}, create: { id: 'platform' } });
    return pc as SettingsRow;
  }

  private phones(cfg: SettingsRow): string[] {
    if (!cfg.securityAlertPhones) return [];
    try { const v = JSON.parse(this.crypto.decrypt(cfg.securityAlertPhones) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
  }

  async settings() {
    const cfg = await this.settingsRow();
    return {
      smsEnabled: cfg.securityAlertsSms, phones: this.phones(cfg), kinds: cfg.securityAlertKinds, realms: cfg.securityAlertRealms,
      workHoursStart: cfg.workHoursStart, workHoursEnd: cfg.workHoursEnd, offHoursFriday: cfg.offHoursFriday,
      allKinds: ALERT_KINDS.map((k) => ({ key: k, label: ALERT_FA[k] })), allRealms: (Object.keys(REALM_FA) as Realm[]).map((k) => ({ key: k, label: REALM_FA[k] })),
    };
  }

  async saveSettings(input: { smsEnabled?: boolean; phones?: string[]; kinds?: string[]; realms?: string[]; workHoursStart?: number; workHoursEnd?: number; offHoursFriday?: boolean }) {
    const data: Record<string, unknown> = {};
    if (input.phones !== undefined) {
      const clean = [...new Set(input.phones.map((p) => normalizeMobile(p)))];
      if (clean.length > 5) throw new BadRequestException('حداکثر ۵ شماره');
      data.securityAlertPhones = clean.length ? this.crypto.encrypt(JSON.stringify(clean)) : null;
    }
    if (input.smsEnabled !== undefined) data.securityAlertsSms = input.smsEnabled;
    if (input.kinds !== undefined) data.securityAlertKinds = input.kinds.filter((k) => (ALERT_KINDS as readonly string[]).includes(k));
    if (input.realms !== undefined) data.securityAlertRealms = input.realms.filter((r) => r in REALM_FA);
    for (const k of ['workHoursStart', 'workHoursEnd'] as const) {
      if (input[k] !== undefined) {
        if (!Number.isInteger(input[k]) || input[k]! < 0 || input[k]! > 24) throw new BadRequestException('ساعت باید عددی بین ۰ تا ۲۴ باشد');
        data[k] = input[k];
      }
    }
    if (input.offHoursFriday !== undefined) data.offHoursFriday = input.offHoursFriday;
    const s = (data.workHoursStart as number | undefined) ?? (await this.settingsRow()).workHoursStart;
    const e = (data.workHoursEnd as number | undefined) ?? (await this.settingsRow()).workHoursEnd;
    if (s >= e) throw new BadRequestException('ساعت شروع باید پیش از ساعت پایان باشد');
    if (data.securityAlertsSms === true && !(input.phones ?? this.phones(await this.settingsRow())).length) throw new BadRequestException('برای فعال کردن پیامک، دست‌کم یک شماره وارد کنید');
    await this.db().platformConfig.upsert({ where: { id: 'platform' }, update: data, create: { id: 'platform', ...data } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'SecurityAlertSettings', metadata: { smsEnabled: input.smsEnabled, phones: input.phones?.length, kinds: input.kinds, realms: input.realms } });
    return this.settings();
  }

  /** «ارسال پیامک آزمایشی» to every configured number. */
  async testSms() {
    const phones = this.phones(await this.settingsRow());
    if (!phones.length) throw new BadRequestException('شماره‌ای ثبت نشده است');
    const out: { phone: string; ok: boolean; error?: string }[] = [];
    for (const p of phones) {
      try { await this.sms.sendViaPlatform(p, 'امنیت ورود دامون — پیامک آزمایشی: هشدارهای ورود به این شماره ارسال می‌شود.'); out.push({ phone: p, ok: true }); }
      catch (e: any) { out.push({ phone: p, ok: false, error: e?.message ?? String(e) }); }
    }
    return { results: out };
  }
}

type SettingsRow = {
  securityAlertsSms: boolean; securityAlertPhones: string | null; securityAlertKinds: string[]; securityAlertRealms: string[];
  workHoursStart: number; workHoursEnd: number; offHoursFriday: boolean;
};

function normalizeMobile(raw: string): string {
  const d = toAsciiDigits(String(raw ?? '')).replace(/[\s-]/g, '').replace(/^\+98/, '0').replace(/^0098/, '0').replace(/^98(9\d{9})$/, '0$1');
  if (!/^09\d{9}$/.test(d)) throw new BadRequestException(`شمارهٔ موبایل نامعتبر است: ${raw}`);
  return d;
}

function tehranClock(d: Date): { hour: number; friday: boolean } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(d);
  return { hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0), friday: parts.find((p) => p.type === 'weekday')?.value === 'Fri' };
}
