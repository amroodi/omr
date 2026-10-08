import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  TooManyRequestsException,
} from './http-exceptions';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';
import { SmsService } from '../auth/sms.service';
import { RequestOtpDto, VerifyOtpDto } from './dto';

/**
 * The secure replacement for the legacy IDOR endpoints (`get_fields.php`,
 * `insurance_status.php?national_code=`).
 *
 * Flow:
 *  1. requestOtp: verify (nationalCode + on-file phone) pair, rate-limit, SMS a hashed OTP.
 *  2. verifyOtp:  check the OTP, then mint a short-lived JWT scoped to ONE case id.
 *  3. getScopedCase (guarded by that token) returns exactly that case, decrypted for its owner.
 *
 * The National ID never appears in a URL, results are never returned without OTP, and a token
 * can never be pivoted to another person's record.
 */
@Injectable()
export class InquiryService {
  private readonly logger = new Logger(InquiryService.name);
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

  async requestOtp(dto: RequestOtpDto): Promise<{ ok: true; message: string }> {
    const tenantId = getTenantIdOrThrow();
    const ctx = getContext();
    const ip = ctx?.ip ?? 'unknown';

    // Rate limit per IP and per National ID to stop enumeration and SMS bombing.
    const nidHash = this.crypto.blindIndex(dto.nationalCode)!;
    const perIp = Number(this.config.get('RL_OTP_ISSUE_PER_IP_PER_HOUR', 10));
    const perNid = Number(this.config.get('RL_OTP_ISSUE_PER_NID_PER_HOUR', 5));
    if (!this.rateLimit.hit(`otp:ip:${ip}`, perIp, 3600)) {
      throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');
    }
    if (!this.rateLimit.hit(`otp:nid:${nidHash}`, perNid, 3600)) {
      throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');
    }

    const phoneHash = this.crypto.blindIndex(this.normalizePhone(dto.phone))!;

    // Look up by blind index only — plaintext National ID is never queried.
    const insured = await this.prisma.scoped.insuredParty.findFirst({
      where: { nationalCodeHash: nidHash, phoneHash },
      select: { id: true },
    });

    // Find the most relevant case for this insured (if the pair matched).
    let caseId: string | null = null;
    if (insured) {
      const c = await this.prisma.scoped.case.findFirst({
        where: { insuredId: insured.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      caseId = c?.id ?? null;
    }

    // Fallback to the new self-service model: a بیمه‌گزار (CustomerAccount) who filed a Claim.
    let claimId: string | null = null;
    let insuredId: string | null = insured?.id ?? null;
    if (!caseId) {
      const account = await this.prisma.scoped.customerAccount.findFirst({
        where: { nationalCodeHash: nidHash, phoneHash },
        select: { id: true },
      });
      if (account) {
        const claim = await this.prisma
          .unscoped()
          .claim.findFirst({ where: { policyHolderId: account.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (claim) {
          claimId = claim.id;
          insuredId = account.id;
        }
      }
    }

    // Always send the same generic response — never reveal whether the pair exists.
    if (caseId || claimId) {
      // ConfigService returns raw env strings; coerce to numbers (Prisma Int columns reject strings).
      const code = this.hash.generateOtp(Number(this.config.get('OTP_LENGTH', 6)));
      const ttl = Number(this.config.get('OTP_TTL_SECONDS', 180));
      await this.prisma.scoped.otpChallenge.create({
        data: {
          tenantId,
          purpose: 'inquiry',
          phoneHash,
          insuredId,
          caseId,
          claimId,
          codeHash: this.hash.hashOtp(code),
          maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS', 5)),
          expiresAt: new Date(Date.now() + ttl * 1000),
        },
      });
      // Quick-inquiry is a Damuon-branded public service: by default its OTP goes through the
      // platform gateway (Damuon's Magfa), not each org's own provider. Super-admin can toggle this.
      try {
        const pc = await this.prisma
          .unscoped()
          .platformConfig.findUnique({ where: { id: 'platform' }, select: { inquiryUsePlatform: true } });
        if (pc?.inquiryUsePlatform ?? true) {
          await this.sms.sendOtpViaPlatform(dto.phone, code);
        } else {
          await this.sms.sendOtp(dto.phone, code, tenantId);
        }
      } catch (e) {
        this.logger.error(`Inquiry OTP send failed (tenant ${tenantId}): ${String(e)}`);
      }
      await this.audit.record({
        action: AuditAction.OTP_ISSUE,
        targetType: claimId ? 'Claim' : 'Case',
        targetId: (claimId ?? caseId) ?? undefined,
        tenantId,
        actorType: 'INSURED',
      });
    }

    return {
      ok: true,
      message: 'در صورت تطابق اطلاعات، کد تایید برای شماره ثبت‌شده ارسال شد.',
    };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ token: string; expiresIn: string }> {
    const tenantId = getTenantIdOrThrow();
    const ctx = getContext();
    const ip = ctx?.ip ?? 'unknown';
    if (!this.rateLimit.hit(`otpverify:ip:${ip}`, 20, 600)) {
      throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است.');
    }

    const phoneHash = this.crypto.blindIndex(this.normalizePhone(dto.phone))!;
    const challenge = await this.prisma.scoped.otpChallenge.findFirst({
      where: { phoneHash, purpose: 'inquiry', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new ForbiddenException('کد نامعتبر یا منقضی شده است.');

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new ForbiddenException('تعداد تلاش‌های مجاز به پایان رسید.');
    }

    const valid = this.hash.verifyOtp(challenge.codeHash, dto.code);
    if (!valid) {
      await this.prisma.scoped.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new ForbiddenException('کد نامعتبر است.');
    }

    await this.prisma.scoped.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    // Mint a token scoped to exactly one record id (case or claim) — not the National ID.
    const token = await this.jwt.signAsync(
      { kind: 'record', tenantId, caseId: challenge.caseId, claimId: challenge.claimId, sub: challenge.insuredId },
      { expiresIn: this.config.get<string>('RECORD_TOKEN_TTL', '10m') },
    );
    await this.audit.record({
      action: AuditAction.OTP_VERIFY,
      targetType: challenge.claimId ? 'Claim' : 'Case',
      targetId: (challenge.claimId ?? challenge.caseId) ?? undefined,
      tenantId,
      actorType: 'INSURED',
    });

    return { token, expiresIn: this.config.get<string>('RECORD_TOKEN_TTL', '10m') };
  }

  /** Returns the single record (legacy case or new-model claim) the token authorizes. */
  async getScopedCase(): Promise<unknown> {
    const ctx = getContext();
    const claimId = ctx?.scopedClaimId;
    if (claimId) return this.getScopedClaim(claimId);

    const caseId = ctx?.scopedCaseId;
    if (!caseId) throw new ForbiddenException('توکن نامعتبر است.');

    const c = await this.prisma.scoped.case.findFirst({
      where: { id: caseId },
      include: {
        insured: true,
        policy: true,
        beneficiary: true,
        payments: { orderBy: { date: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('پرونده یافت نشد.');

    await this.audit.record({
      action: AuditAction.VIEW,
      targetType: 'Case',
      targetId: caseId,
      actorType: 'INSURED',
    });

    return this.presentCase(c);
  }

  /** Returns the single new-model claim the token authorizes (self-service بیمه‌گزار inquiry). */
  private async getScopedClaim(claimId: string): Promise<unknown> {
    const c = await this.prisma.unscoped().claim.findUnique({
      where: { id: claimId },
      include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true },
    });
    if (!c) throw new NotFoundException('پرونده یافت نشد.');

    await this.audit.record({ action: AuditAction.VIEW, targetType: 'Claim', targetId: claimId, actorType: 'INSURED' });

    const dec = (v: string | null) => (v ? this.crypto.decrypt(v) : null);
    return {
      kind: 'claim',
      claimNumber: c.claimNumber,
      status: c.status,
      claimType: c.claimType,
      deceasedName: dec(c.deceasedFullName),
      eventDate: c.eventDate ? toJalali(c.eventDate, false) : null,
      description: c.description ?? null,
      createdAt: c.createdAt ? toJalali(c.createdAt, false) : null,
      steps: (c.steps ?? []).map((s: any) => ({ order: s.order, partyType: s.partyType, state: s.state })),
      deficiencies: (c.deficiencies ?? []).map((d: any) => ({ items: this.safeParse(d.items), resolvedAt: d.resolvedAt ? toJalali(d.resolvedAt, false) : null })),
    };
  }

  private safeParse(v: string | null): string[] {
    if (!v) return [];
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }

  /** Decrypt + Jalali-format a case for its owner. National ID is masked even here. */
  private presentCase(c: any): unknown {
    const dec = (v: string | null) => (v ? this.crypto.decrypt(v) : null);
    const nid = dec(c.insured?.nationalCode);
    return {
      caseNumber: c.caseNumber,
      status: c.status,
      insured: {
        fullName: dec(c.insured?.fullName),
        nationalCodeMasked: nid ? `••••••${nid.slice(-4)}` : null,
        dateOfDeath: c.insured?.dateOfDeath ? toJalali(c.insured.dateOfDeath, false) : null,
      },
      beneficiary: c.beneficiary
        ? { fullName: dec(c.beneficiary.fullName), type: c.beneficiary.type }
        : null,
      policy: c.policy
        ? {
            policyNumber: c.policy.policyNumber,
            carrier: c.policy.carrier,
            status: c.policy.status,
            startDate: c.policy.startDate ? toJalali(c.policy.startDate, false) : null,
          }
        : null,
      workflow: {
        stageDate: this.j(c.stageDate),
        docsRequestedAt: this.j(c.docsRequestedAt),
        docsSentAt: this.j(c.docsSentAt),
        sentToHqAt: this.j(c.sentToHqAt),
        approvedAt: this.j(c.approvedAt),
        paidAt: this.j(c.paidAt),
      },
      payments: (c.payments ?? []).map((p: any) => ({
        date: this.j(p.date),
        description: p.description,
        amount: p.amount?.toString(),
        status: p.status,
      })),
    };
  }

  private j(d: Date | null): string | null {
    return d ? toJalali(d, false) : null;
  }

  private normalizePhone(phone: string): string {
    const p = phone.replace(/\D/g, '');
    if (p.startsWith('98')) return '0' + p.slice(2);
    if (p.startsWith('0')) return p;
    if (p.startsWith('9')) return '0' + p;
    return p;
  }
}
