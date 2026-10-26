import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { SmsService } from '../auth/sms.service';
import { CustomerService } from './customer.service';

/**
 * Customer realm (بیمه‌گزار panel) authentication.
 *
 * Login = «کد بیمه‌گزار» + password: one login per company, whatever lines (عمر / حوادث) it holds. The
 * token's `companyId` lets the panel see every claim of that company.
 *
 * The older person login (National ID + phone + OTP, plus self-signup) is kept for a later بیمه‌شده
 * portal but is OFF unless CUSTOMER_NID_LOGIN=true.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly hash: HashService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
    private readonly customers: CustomerService,
  ) {}

  // ── Company login: کد بیمه‌گزار + password ──
  async companyLogin(code: string, password: string): Promise<{ token: string; expiresIn: string }> {
    const tenantId = getTenantIdOrThrow();
    const ip = getContext()?.ip ?? 'unknown';
    const key = code.trim();
    if (!this.rateLimit.hit(`custpw:ip:${ip}`, 30, 600)) throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.');
    if (!this.rateLimit.hit(`custpw:code:${tenantId}:${key}`, 10, 600)) throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.');
    const db = this.prisma.unscoped();
    if (key.toLowerCase() === 'broker') return this.brokerLogin(tenantId, password);
    const co = await db.policyholderCompany.findFirst({ where: { tenantId, code: key } });
    const ok = !!co?.isActive && !!co.passwordHash && (await this.hash.verifyPassword(co.passwordHash, password));
    if (!co || !ok) {
      await this.audit.record({ action: AuditAction.LOGIN_FAILED, tenantId, actorType: 'CUSTOMER', metadata: { realm: 'company', code: key } });
      throw new ForbiddenException('کد بیمه‌گزار یا رمز عبور نادرست است.');
    }
    const account = await this.companyAccount(co);
    await db.customerAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync({ kind: 'customer', sub: account.id, tenantId, nidHash: account.nationalCodeHash, companyId: co.id }, { expiresIn });
    await this.audit.record({ action: AuditAction.LOGIN, tenantId, actorType: 'CUSTOMER', actorId: account.id, metadata: { realm: 'company', companyId: co.id } });
    return { token, expiresIn };
  }

  /**
   * The brokerage's own login on the بیمه‌گزار panel: username «broker» (typed in the کد بیمه‌گزار box),
   * password set by super admin. It sees every company of the brokerage and files / uploads for any.
   */
  private async brokerLogin(tenantId: string, password: string) {
    const db = this.prisma.unscoped();
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, isActive: true, brokerPanelPasswordHash: true, name: true } });
    const ok = t?.kind === 'BROKER' && t.isActive && !!t.brokerPanelPasswordHash && (await this.hash.verifyPassword(t.brokerPanelPasswordHash, password));
    if (!ok) {
      await this.audit.record({ action: AuditAction.LOGIN_FAILED, tenantId, actorType: 'CUSTOMER', metadata: { realm: 'broker-panel' } });
      throw new ForbiddenException('کد بیمه‌گزار یا رمز عبور نادرست است.');
    }
    const nationalCodeHash = this.crypto.blindIndex(`broker:${tenantId}`)!;
    const account = (await db.customerAccount.findFirst({ where: { tenantId, nationalCodeHash }, select: { id: true } }))
      ?? (await db.customerAccount.create({
        data: { tenantId, nationalCodeHash, nationalCode: this.crypto.encrypt('broker')!, fullName: this.crypto.encrypt(t!.name), signupStatus: 'ACTIVE', isActive: true },
        select: { id: true },
      }));
    await db.customerAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync({ kind: 'customer', sub: account.id, tenantId, nidHash: nationalCodeHash, brokerPanel: true }, { expiresIn });
    await this.audit.record({ action: AuditAction.LOGIN, tenantId, actorType: 'CUSTOMER', actorId: account.id, metadata: { realm: 'broker-panel' } });
    return { token, expiresIn };
  }

  /** The company's own panel account (created on first login); claims it files are linked to it. */
  private async companyAccount(co: { id: string; tenantId: string; code: string | null; name: string }) {
    const db = this.prisma.unscoped();
    const nationalCodeHash = this.crypto.blindIndex(`company:${co.id}`)!;
    const found = await db.customerAccount.findFirst({ where: { tenantId: co.tenantId, nationalCodeHash }, select: { id: true, nationalCodeHash: true } });
    if (found) return found;
    return db.customerAccount.create({
      data: {
        tenantId: co.tenantId, companyId: co.id, nationalCodeHash,
        nationalCode: this.crypto.encrypt(`company:${co.code ?? co.id}`)!, fullName: this.crypto.encrypt(co.name),
        signupStatus: 'ACTIVE', isActive: true,
      },
      select: { id: true, nationalCodeHash: true },
    });
  }

  /** A company login changes its own password (needs the current one). */
  async changeCompanyPassword(current: string, next: string) {
    const ctx = getContext();
    if (ctx?.customerBrokerPanel) throw new ForbiddenException('رمز ورود کارگزاری را مدیر سامانه تغییر می‌دهد.');
    if (ctx?.actorType !== 'CUSTOMER' || !ctx.customerCompanyId) throw new ForbiddenException('فقط برای ورود با کد بیمه‌گزار');
    if (!next || next.length < 8) throw new BadRequestException('رمز عبور جدید باید دست‌کم ۸ نویسه باشد.');
    const db = this.prisma.unscoped();
    const co = await db.policyholderCompany.findUnique({ where: { id: ctx.customerCompanyId } });
    if (!co?.passwordHash || !(await this.hash.verifyPassword(co.passwordHash, current))) throw new ForbiddenException('رمز عبور فعلی نادرست است.');
    if (next === current) throw new BadRequestException('رمز عبور جدید باید با رمز فعلی فرق داشته باشد.');
    await db.policyholderCompany.update({ where: { id: co.id }, data: { passwordHash: await this.hash.hashPassword(next), passwordSetAt: new Date(), mustChangePassword: false } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: co.tenantId, actorType: 'CUSTOMER', actorId: ctx.actorId, targetType: 'PolicyholderPassword', targetId: co.id });
    return { ok: true };
  }

  /** Person login / signup by National ID — kept for a later بیمه‌شده portal, off for now. */
  private assertNidLogin() {
    if (String(this.config.get('CUSTOMER_NID_LOGIN', 'false')).toLowerCase() !== 'true') {
      throw new ForbiddenException('ورود با کد ملی غیرفعال است؛ با «کد بیمه‌گزار» و رمز عبور وارد شوید.');
    }
  }

  // ── Self-signup phone verification (OTP sent via the HOST/platform gateway) ──
  async requestSignupOtp(tenantSlug: string, nationalCode: string, phone: string): Promise<{ ok: true; message: string; otpRequired: boolean }> {
    this.assertNidLogin();
    const ip = getContext()?.ip ?? 'unknown';
    const db = this.prisma.unscoped();
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug.trim() }, select: { id: true, isActive: true } });
    if (!tenant || !tenant.isActive) throw new NotFoundException('سازمان یافت نشد');

    // OTP disabled platform-wide → sign up directly (client calls /signup/direct), no SMS.
    if (!(await this.otpEnabled())) {
      return { ok: true, otpRequired: false, message: 'ثبت‌نام بدون کد تایید فعال است.' };
    }

    if (!this.rateLimit.hit(`signupotp:ip:${ip}`, 10, 3600)) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است.');
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(phone))!;
    if (!this.rateLimit.hit(`signupotp:ph:${phoneHash}`, 5, 3600)) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است.');

    const nidHash = this.crypto.blindIndex(nationalCode.trim())!;
    const existing = await db.customerAccount.findFirst({ where: { tenantId: tenant.id, nationalCodeHash: nidHash, signupStatus: 'ACTIVE' }, select: { id: true } });
    if (existing) throw new BadRequestException('شما قبلاً در این سازمان ثبت شده‌اید؛ وارد شوید.');

    const code = this.hash.generateOtp(Number(this.config.get('OTP_LENGTH', 6)));
    const ttl = Number(this.config.get('OTP_TTL_SECONDS', 180));
    await db.otpChallenge.create({
      data: {
        tenantId: tenant.id,
        purpose: 'signup',
        phoneHash,
        codeHash: this.hash.hashOtp(code),
        maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS', 5)),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    try {
      await this.sms.sendOtpViaPlatform(phone, code); // host gateway, since the user is not yet in any org
    } catch (e) {
      this.logger.error(`Signup OTP send failed (platform): ${String(e)}`);
    }
    await this.audit.record({ action: AuditAction.OTP_ISSUE, tenantId: tenant.id, actorType: 'INSURED', metadata: { realm: 'signup' } });
    return { ok: true, otpRequired: true, message: 'کد تایید به شماره شما ارسال شد.' };
  }

  async verifySignupOtp(dto: { tenantSlug: string; nationalCode: string; phone: string; code: string; fullName?: string }) {
    this.assertNidLogin();
    const ip = getContext()?.ip ?? 'unknown';
    const db = this.prisma.unscoped();
    const tenant = await db.tenant.findUnique({ where: { slug: dto.tenantSlug.trim() }, select: { id: true, isActive: true } });
    if (!tenant || !tenant.isActive) throw new NotFoundException('سازمان یافت نشد');
    if (!this.rateLimit.hit(`signupverify:ip:${ip}`, 20, 600)) throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است.');

    const phoneHash = this.crypto.blindIndex(this.normalizePhone(dto.phone))!;
    const challenge = await db.otpChallenge.findFirst({
      where: { tenantId: tenant.id, phoneHash, purpose: 'signup', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new ForbiddenException('کد نامعتبر یا منقضی شده است.');
    if (challenge.attempts >= challenge.maxAttempts) throw new ForbiddenException('تعداد تلاش‌ها به پایان رسید.');
    if (!this.hash.verifyOtp(challenge.codeHash, dto.code)) {
      await db.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new ForbiddenException('کد نامعتبر است.');
    }
    await db.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    // Phone verified → create the PENDING signup request (still needs org approval).
    return this.customers.signup({ tenantSlug: dto.tenantSlug, nationalCode: dto.nationalCode, phone: dto.phone, fullName: dto.fullName });
  }

  /** Platform master switch: is OTP required at all? (false = direct login, no code). */
  private async otpEnabled(): Promise<boolean> {
    const pc = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { otpEnabled: true } });
    return pc?.otpEnabled ?? true;
  }

  async requestOtp(nationalCode: string, phone: string): Promise<{ ok: true; message: string; otpRequired: boolean }> {
    this.assertNidLogin();
    const tenantId = getTenantIdOrThrow();
    const ip = getContext()?.ip ?? 'unknown';
    const nidHash = this.crypto.blindIndex(nationalCode)!;
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(phone))!;

    // OTP disabled platform-wide → tell the client to log in directly (no SMS, no code).
    if (!(await this.otpEnabled())) {
      return { ok: true, otpRequired: false, message: 'ورود بدون کد تایید فعال است.' };
    }

    if (!this.rateLimit.hit(`custotp:ip:${ip}`, 10, 3600)) {
      throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است.');
    }
    if (!this.rateLimit.hit(`custotp:nid:${nidHash}`, 5, 3600)) {
      throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است.');
    }

    const account = await this.prisma.scoped.customerAccount.findFirst({
      where: { nationalCodeHash: nidHash, phoneHash, isActive: true, signupStatus: 'ACTIVE' },
      select: { id: true },
    });

    if (account) {
      // ConfigService returns raw env strings; coerce to numbers (Prisma Int columns reject strings).
      const code = this.hash.generateOtp(Number(this.config.get('OTP_LENGTH', 6)));
      const ttl = Number(this.config.get('OTP_TTL_SECONDS', 180));
      await this.prisma.scoped.otpChallenge.create({
        data: {
          tenantId,
          purpose: 'customer',
          phoneHash,
          codeHash: this.hash.hashOtp(code),
          maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS', 5)),
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      });
      // A provider failure must not 500 the login nor reveal whether the account exists.
      try {
        await this.sms.sendOtp(phone, code, tenantId);
      } catch (e) {
        this.logger.error(`Customer OTP send failed (tenant ${tenantId}): ${String(e)}`);
      }
      await this.audit.record({ action: AuditAction.OTP_ISSUE, tenantId, actorType: 'CUSTOMER', metadata: { realm: 'customer' } });
      return { ok: true, otpRequired: true, message: 'در صورت وجود حساب، کد تایید ارسال شد.' };
    }

    // No ACTIVE account. If a signup exists but is pending/rejected, say so clearly so the user
    // isn't left waiting for a code that will never arrive (they proved phone ownership at signup).
    const signup = await this.prisma.scoped.customerAccount.findFirst({
      where: { nationalCodeHash: nidHash, phoneHash },
      select: { signupStatus: true },
    });
    if (signup?.signupStatus === 'PENDING') {
      throw new ForbiddenException('درخواست ثبت‌نام شما هنوز توسط سازمان تایید نشده است. پس از تایید، امکان ورود خواهید داشت.');
    }
    if (signup?.signupStatus === 'REJECTED') {
      throw new ForbiddenException('درخواست ثبت‌نام شما تایید نشد. برای پیگیری با سازمان تماس بگیرید.');
    }

    return { ok: true, otpRequired: true, message: 'در صورت وجود حساب، کد تایید ارسال شد.' };
  }

  async verifyOtp(nationalCode: string, phone: string, code: string): Promise<{ token: string; expiresIn: string }> {
    this.assertNidLogin();
    const tenantId = getTenantIdOrThrow();
    const ip = getContext()?.ip ?? 'unknown';
    if (!this.rateLimit.hit(`custverify:ip:${ip}`, 20, 600)) {
      throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است.');
    }
    const nidHash = this.crypto.blindIndex(nationalCode)!;
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(phone))!;

    const challenge = await this.prisma.scoped.otpChallenge.findFirst({
      where: { phoneHash, purpose: 'customer', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new ForbiddenException('کد نامعتبر یا منقضی شده است.');
    if (challenge.attempts >= challenge.maxAttempts) throw new ForbiddenException('تعداد تلاش‌ها به پایان رسید.');

    if (!this.hash.verifyOtp(challenge.codeHash, code)) {
      await this.prisma.scoped.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new ForbiddenException('کد نامعتبر است.');
    }

    const account = await this.prisma.scoped.customerAccount.findFirst({
      where: { nationalCodeHash: nidHash, phoneHash, isActive: true, signupStatus: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) throw new ForbiddenException('حساب یافت نشد.');

    await this.prisma.scoped.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    await this.prisma.scoped.customerAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });

    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync(
      { kind: 'customer', sub: account.id, tenantId, nidHash },
      { expiresIn },
    );
    await this.audit.record({ action: AuditAction.OTP_VERIFY, tenantId, actorType: 'CUSTOMER', actorId: account.id, metadata: { realm: 'customer' } });
    return { token, expiresIn };
  }

  /** Log in with National ID + phone and NO code — only permitted when OTP is disabled. */
  async directLogin(nationalCode: string, phone: string): Promise<{ token: string; expiresIn: string }> {
    this.assertNidLogin();
    if (await this.otpEnabled()) throw new ForbiddenException('کد تایید لازم است.');
    const tenantId = getTenantIdOrThrow();
    const nidHash = this.crypto.blindIndex(nationalCode)!;
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(phone))!;
    const account = await this.prisma.scoped.customerAccount.findFirst({
      where: { nationalCodeHash: nidHash, phoneHash, isActive: true, signupStatus: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) throw new ForbiddenException('حساب یافت نشد.');
    await this.prisma.scoped.customerAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    const expiresIn = this.config.get<string>('JWT_SESSION_TTL', '8h');
    const token = await this.jwt.signAsync({ kind: 'customer', sub: account.id, tenantId, nidHash }, { expiresIn });
    await this.audit.record({ action: AuditAction.LOGIN, tenantId, actorType: 'CUSTOMER', actorId: account.id, metadata: { realm: 'customer', otp: false } });
    return { token, expiresIn };
  }

  /** Create a pending signup with NO phone verification — only permitted when OTP is disabled. */
  async directSignup(dto: { tenantSlug: string; nationalCode: string; phone: string; fullName?: string }) {
    this.assertNidLogin();
    if (await this.otpEnabled()) throw new ForbiddenException('کد تایید لازم است.');
    return this.customers.signup({ tenantSlug: dto.tenantSlug, nationalCode: dto.nationalCode, phone: dto.phone, fullName: dto.fullName });
  }

  private normalizePhone(phone: string): string {
    const p = phone.replace(/\D/g, '');
    if (p.startsWith('98')) return '0' + p.slice(2);
    if (p.startsWith('9')) return '0' + p;
    return p;
  }
}
