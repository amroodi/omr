import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext } from '../../common/tenant/tenant-context';
import { homePanel } from '../auth/auth.service';
import { MfaService } from '../auth/mfa.service';
import { CustomerAuthService } from '../customer/customer-auth.service';
import { SessionsService } from '../security/sessions.service';

/** How long a «ورود به پنل» lasts. No renewal: the Super Admin starts a new one (with a fresh code). */
export const ASSIST_TTL_MIN = 30;

export type AssistTarget = 'ORG' | 'COMPANY' | 'REPRESENTATIVE';

/**
 * Super Admin «ورود به پنل»: enter any organization's panel as one of its operators, a بیمه‌گزار company or a
 * نماینده, to help them or step in. Each entry needs a fresh authenticator code, lasts 30 minutes, shows a
 * banner, texts the Super Admin's own numbers, and every action is recorded under the Super Admin (the
 * token's `assist`), never under the person helped. In that session Super Admin may both create and
 * process (the panel 1 / panel 2 rule doesn't bind level 5), but can't change that person's password or
 * two-step login.
 */
@Injectable()
export class AssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly crypto: FieldCryptoService,
    private readonly customers: CustomerAuthService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  /** Who can be entered in this organization: its operators, and (a brokerage) its companies and نمایندگان. */
  async targets(tenantId: string) {
    const db = this.db();
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, kind: true, name: true, slug: true } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    const [users, companies, reps] = await Promise.all([
      db.orgUser.findMany({ where: { tenantId }, orderBy: { displayName: 'asc' }, select: { id: true, username: true, displayName: true, isActive: true, desk: true, branchId: true, role: { select: { name: true } } } }),
      t.kind === 'BROKER' ? db.policyholderCompany.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true } }) : [],
      t.kind === 'BROKER' ? db.customerAccount.findMany({ where: { tenantId, removedAt: null, passwordHash: { not: null } }, select: { id: true, fullName: true, isActive: true, company: { select: { name: true } } } }) : [],
    ]);
    return {
      tenant: t,
      users: users.map((u) => ({ id: u.id, name: u.displayName || u.username, username: u.username, role: u.role?.name ?? null, panel: homePanel(t.kind, u), isActive: u.isActive })),
      companies,
      representatives: reps.map((r) => ({ id: r.id, name: (r.fullName && this.crypto.decrypt(r.fullName)) || 'نماینده', company: r.company?.name ?? null, isActive: r.isActive })),
    };
  }

  async start(input: { tenantId: string; target: AssistTarget; id: string; mode?: 'ENTRY' | 'PROCESS'; totp: string }) {
    const ctx = getContext();
    const superId = ctx?.actorType === 'SUPER_ADMIN' ? ctx.actorId : undefined;
    if (!superId) throw new ForbiddenException('فقط مدیر سامانه');
    if (!(await this.rateLimit.hit(`assist:${superId}`, 20, 3600))) throw new TooManyRequestsException('تعداد ورود به پنل‌ها در این ساعت زیاد است؛ کمی بعد دوباره تلاش کنید.');
    const db = this.db();
    const admin = await db.superAdmin.findUnique({ where: { id: superId } });
    if (!admin?.isActive) throw new ForbiddenException('فقط مدیر سامانه');
    // A fresh code every time: a stolen or left-open Super Admin tab can't enter anyone's panel on its own.
    if (!admin.totpSecret) throw new ForbiddenException({ statusCode: 403, code: 'MFA_SETUP_REQUIRED', message: 'برای ورود به پنل سازمان‌ها ابتدا ورود دومرحله‌ای مدیر سامانه را راه‌اندازی کنید.' });
    if (!input.totp?.trim()) throw new BadRequestException({ statusCode: 400, code: 'MFA_REQUIRED', message: 'کد برنامهٔ احراز هویت را وارد کنید' });
    await this.mfa.check({ kind: 'SUPER_ADMIN', id: superId }, admin, input.totp.trim());

    const tenant = await db.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true, kind: true, name: true, slug: true, isActive: true } });
    if (!tenant) throw new NotFoundException('سازمان یافت نشد');
    const expiresIn = `${ASSIST_TTL_MIN}m`;
    const by = `مدیر سامانه (${admin.email})`;

    let token: string; let realm: 'org' | 'customer'; let label: string; let sid: string; let home: string;
    if (input.target === 'ORG') {
      const user = await db.orgUser.findFirst({ where: { id: input.id, tenantId: tenant.id }, include: { role: true } });
      if (!user) throw new NotFoundException('کاربر یافت نشد');
      const panel = homePanel(tenant.kind, user);
      const mode = input.mode === 'ENTRY' ? 'ENTRY' : 'PROCESS';
      label = `${user.displayName || user.username} (${user.username}) — ${tenant.name}`;
      sid = await this.sessions.start({ realm: 'ORG', actorId: user.id, actorLabel: `${by} ← ${label}`, tenantId: tenant.id });
      token = await this.jwt.signAsync(
        { kind: 'org', sub: user.id, sid, tenantId: tenant.id, permissions: user.role?.permissions ?? [], branchId: user.branchId ?? null, panel, mode, assist: superId, assistName: label },
        { expiresIn },
      );
      realm = 'org'; home = '/org/work-desk';
    } else if (input.target === 'COMPANY') {
      const co = await db.policyholderCompany.findFirst({ where: { id: input.id, tenantId: tenant.id } });
      if (!co) throw new NotFoundException('بیمه‌گزار یافت نشد');
      const account = await this.customers.companyAccount(co);
      label = `بیمه‌گزار: ${co.name}`;
      sid = await this.sessions.start({ realm: 'CUSTOMER', actorId: account.id, actorLabel: `${by} ← ${label}`, tenantId: tenant.id });
      token = await this.jwt.signAsync(
        { kind: 'customer', sub: account.id, sid, tenantId: tenant.id, nidHash: account.nationalCodeHash, companyId: co.id, permissions: ['representatives:manage'], assist: superId, assistName: label },
        { expiresIn },
      );
      realm = 'customer'; home = '/customer';
    } else {
      const acc = await db.customerAccount.findFirst({ where: { id: input.id, tenantId: tenant.id, removedAt: null, passwordHash: { not: null } } });
      if (!acc) throw new NotFoundException('نماینده یافت نشد');
      label = `نماینده: ${(acc.fullName && this.crypto.decrypt(acc.fullName)) || '—'}`;
      sid = await this.sessions.start({ realm: 'CUSTOMER', actorId: acc.id, actorLabel: `${by} ← ${label}`, tenantId: tenant.id });
      token = await this.jwt.signAsync(
        { kind: 'customer', sub: acc.id, sid, tenantId: tenant.id, nidHash: acc.nationalCodeHash, companyId: acc.companyId ?? undefined, representative: true, assist: superId, assistName: label },
        { expiresIn },
      );
      realm = 'customer'; home = '/customer';
    }

    await this.audit.record({
      action: AuditAction.LOGIN, actorType: 'SUPER_ADMIN', actorId: superId, tenantId: tenant.id, targetType: 'Assist', targetId: input.id,
      metadata: { assist: true, target: input.target, mode: input.mode ?? null, label, minutes: ASSIST_TTL_MIN },
    });
    await this.sessions.assistAlert({ id: sid, actorId: superId, actorLabel: by }, `${by} وارد پنل «${label}» شد (${ASSIST_TTL_MIN} دقیقه).`);
    return { token, realm, tenantSlug: tenant.slug, expiresIn, minutes: ASSIST_TTL_MIN, home, label, mode: input.mode ?? 'PROCESS' };
  }
}
