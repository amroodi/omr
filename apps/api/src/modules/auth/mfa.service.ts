import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { HashService } from '../../common/crypto/hash.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../common/crypto/totp';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';

type Who = { kind: 'ORG_USER' | 'SUPER_ADMIN'; id: string };
interface MfaRow { id: string; totpSecret: string | null; totpPending: string | null; totpLastStep: number | null; passwordHash: string }

/**
 * Two-step login («ورود دومرحله‌ای») for org operators and super admins: after the password, a
 * 6-digit code from an authenticator app (Google / Microsoft Authenticator…). Secrets are encrypted at
 * rest; each code works once (the accepted time step is stored).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly hash: HashService,
    private readonly audit: AuditService,
  ) {}

  private me(): Who {
    const ctx = getContext();
    if (ctx?.actorType === 'ORG_USER' && ctx.actorId) return { kind: 'ORG_USER', id: ctx.actorId };
    if (ctx?.actorType === 'SUPER_ADMIN' && ctx.actorId) return { kind: 'SUPER_ADMIN', id: ctx.actorId };
    throw new ForbiddenException('ورود دومرحله‌ای فقط برای کاربران سازمان و مدیر سامانه است');
  }

  private async row(w: Who): Promise<MfaRow & { label: string; tenantId: string | null }> {
    const db = this.prisma.unscoped();
    if (w.kind === 'ORG_USER') {
      const u = await db.orgUser.findUnique({ where: { id: w.id }, include: { tenant: { select: { slug: true } } } });
      if (!u) throw new NotFoundException('کاربر یافت نشد');
      return { ...u, label: `${u.username}@${u.tenant.slug}`, tenantId: u.tenantId };
    }
    const a = await db.superAdmin.findUnique({ where: { id: w.id } });
    if (!a) throw new NotFoundException('کاربر یافت نشد');
    return { ...a, label: a.email, tenantId: null };
  }

  private async save(w: Who, data: Partial<Pick<MfaRow, 'totpSecret' | 'totpPending' | 'totpLastStep'>>) {
    const db = this.prisma.unscoped();
    if (w.kind === 'ORG_USER') await db.orgUser.update({ where: { id: w.id }, data });
    else await db.superAdmin.update({ where: { id: w.id }, data });
  }

  async status() {
    const w = this.me();
    const r = await this.row(w);
    const required = r.tenantId ? !!(await this.prisma.unscoped().tenant.findUnique({ where: { id: r.tenantId }, select: { requireMfa: true } }))?.requireMfa : false;
    return { enabled: !!r.totpSecret, required };
  }

  /** Start setup: a new secret (kept pending until a first code confirms it). Needs the password. */
  async setup(password: string) {
    const w = this.me();
    const r = await this.row(w);
    if (!(await this.hash.verifyPassword(r.passwordHash, password ?? ''))) throw new UnauthorizedException('رمز عبور نادرست است');
    const secret = generateTotpSecret();
    await this.save(w, { totpPending: this.crypto.encrypt(secret) });
    return { secret, uri: otpauthUri('Damuon', r.label, secret) };
  }

  /** Confirm setup with the first code from the app — two-step login is on from now. */
  async enable(code: string) {
    const w = this.me();
    const r = await this.row(w);
    const secret = r.totpPending ? this.crypto.decrypt(r.totpPending) : null;
    if (!secret) throw new BadRequestException('ابتدا راه‌اندازی را شروع کنید');
    const step = verifyTotp(secret, code);
    if (step == null) throw new BadRequestException('کد نادرست است؛ کد تازهٔ برنامه را وارد کنید');
    await this.save(w, { totpSecret: this.crypto.encrypt(secret), totpPending: null, totpLastStep: step });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: r.tenantId ?? undefined, actorType: w.kind, actorId: w.id, targetType: 'Mfa', targetId: w.id, metadata: { enabled: true } });
    return { ok: true, enabled: true };
  }

  /** Turn it off (password + a current code); not allowed while the org requires it. */
  async disable(password: string, code: string) {
    const w = this.me();
    const r = await this.row(w);
    if (!r.totpSecret) return { ok: true, enabled: false };
    if (r.tenantId && (await this.prisma.unscoped().tenant.findUnique({ where: { id: r.tenantId }, select: { requireMfa: true } }))?.requireMfa) {
      throw new ForbiddenException('ورود دومرحله‌ای برای سازمان شما الزامی است و خاموش نمی‌شود');
    }
    if (!(await this.hash.verifyPassword(r.passwordHash, password ?? ''))) throw new UnauthorizedException('رمز عبور نادرست است');
    await this.check(w, r, code);
    await this.save(w, { totpSecret: null, totpPending: null, totpLastStep: null });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: r.tenantId ?? undefined, actorType: w.kind, actorId: w.id, targetType: 'Mfa', targetId: w.id, metadata: { enabled: false } });
    return { ok: true, enabled: false };
  }

  /**
   * Login step two: throws unless `code` is a fresh valid code for this account. Used by AuthService
   * right after the password matched.
   */
  async check(w: Who, r: Pick<MfaRow, 'totpSecret' | 'totpLastStep'>, code: string | undefined) {
    const secret = r.totpSecret ? this.crypto.decrypt(r.totpSecret) : null;
    if (!secret) return;
    if (!code) throw new UnauthorizedException({ statusCode: 401, code: 'MFA_REQUIRED', message: 'کد ورود دومرحله‌ای (برنامهٔ احراز هویت) را وارد کنید' });
    const step = verifyTotp(secret, code);
    if (step == null || (r.totpLastStep != null && step <= r.totpLastStep)) {
      throw new UnauthorizedException({ statusCode: 401, code: 'MFA_INVALID', message: 'کد ورود دومرحله‌ای نادرست یا تکراری است' });
    }
    await this.save(w, { totpLastStep: step });
  }

  /** Org admin: clear a user's two-step login (lost phone) — they set it up again at next login. */
  async resetForUser(userId: string) {
    const ctx = getContext();
    const db = this.prisma.unscoped();
    const u = await db.orgUser.findFirst({ where: { id: userId, tenantId: ctx?.tenantId ?? '' }, select: { id: true, username: true } });
    if (!u) throw new NotFoundException('کاربر یافت نشد');
    await db.orgUser.update({ where: { id: u.id }, data: { totpSecret: null, totpPending: null, totpLastStep: null } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'Mfa', targetId: u.id, metadata: { reset: true, username: u.username } });
    return { ok: true };
  }
}
