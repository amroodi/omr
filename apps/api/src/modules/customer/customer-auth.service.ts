import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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

/**
 * Customer realm authentication — a persistent account for insured people & beneficiaries.
 * Login = National ID + on-file phone + OTP. On success, issues a `customer` token scoped to that
 * person's own cases (matched by nationalCodeHash), not to a single record.
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
  ) {}

  async requestOtp(nationalCode: string, phone: string): Promise<{ ok: true; message: string }> {
    const tenantId = getTenantIdOrThrow();
    const ip = getContext()?.ip ?? 'unknown';
    const nidHash = this.crypto.blindIndex(nationalCode)!;
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(phone))!;

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
    }

    return { ok: true, message: 'در صورت وجود حساب، کد تایید ارسال شد.' };
  }

  async verifyOtp(nationalCode: string, phone: string, code: string): Promise<{ token: string; expiresIn: string }> {
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

  private normalizePhone(phone: string): string {
    const p = phone.replace(/\D/g, '');
    if (p.startsWith('98')) return '0' + p.slice(2);
    if (p.startsWith('9')) return '0' + p;
    return p;
  }
}
