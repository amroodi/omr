import {
  BadRequestException,
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
import { toJalali, toPersianDigits } from '../../common/jalali/jalali.util';
import { SmsService } from '../auth/sms.service';
import { RequestOtpDto, VerifyOtpDto } from './dto';
import { chainOf, Stage, STAGE_FA } from '../claims/workflow';
import { ageAt } from '../claims/claims.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClaimFieldsService } from '../claim-fields/claim-fields.service';
import { PolicyholdersService } from '../policyholders/policyholders.service';

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
    private readonly policyholders: PolicyholdersService,
    private readonly notifications: NotificationsService,
    private readonly fields: ClaimFieldsService,
  ) {}

  /** Platform master switch: is OTP required at all? (false = view record directly, no code). */
  private async otpEnabled(): Promise<boolean> {
    const pc = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { otpEnabled: true } });
    return pc?.otpEnabled ?? true;
  }

  /** Resolve the single record (legacy Case or new Claim) a National ID + phone unlocks. */
  private async matchRecord(nidHash: string, phoneHash: string): Promise<{ caseId: string | null; claimId: string | null; insuredId: string | null }> {
    const insured = await this.prisma.scoped.insuredParty.findFirst({ where: { nationalCodeHash: nidHash, phoneHash }, select: { id: true } });
    let caseId: string | null = null;
    if (insured) {
      const c = await this.prisma.scoped.case.findFirst({ where: { insuredId: insured.id }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
      caseId = c?.id ?? null;
    }
    let claimId: string | null = null;
    let insuredId: string | null = insured?.id ?? null;
    if (!caseId) {
      const account = await this.prisma.scoped.customerAccount.findFirst({ where: { nationalCodeHash: nidHash, phoneHash }, select: { id: true } });
      if (account) {
        const claim = await this.prisma.unscoped().claim.findFirst({ where: { policyHolderId: account.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (claim) { claimId = claim.id; insuredId = account.id; }
      }
    }
    return { caseId, claimId, insuredId };
  }

  async requestOtp(dto: RequestOtpDto): Promise<{ ok: true; message: string; otpRequired: boolean }> {
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

    // OTP disabled platform-wide → client views the record directly (via /inquiry/direct).
    if (!(await this.otpEnabled())) {
      return { ok: true, otpRequired: false, message: 'مشاهده پرونده بدون کد تایید فعال است.' };
    }

    const phoneHash = this.crypto.blindIndex(this.normalizePhone(dto.phone))!;
    const { caseId, claimId, insuredId } = await this.matchRecord(nidHash, phoneHash);

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
      otpRequired: true,
      message: 'در صورت تطابق اطلاعات، کد تایید برای شماره ثبت‌شده ارسال شد.',
    };
  }

  /** View a record with no code — only when OTP is disabled. Mints the same record-scoped token. */
  async directVerify(dto: RequestOtpDto): Promise<{ token: string; expiresIn: string }> {
    if (await this.otpEnabled()) throw new ForbiddenException('کد تایید لازم است.');
    const tenantId = getTenantIdOrThrow();
    const nidHash = this.crypto.blindIndex(dto.nationalCode)!;
    const phoneHash = this.crypto.blindIndex(this.normalizePhone(dto.phone))!;
    const { caseId, claimId, insuredId } = await this.matchRecord(nidHash, phoneHash);
    if (!caseId && !claimId) throw new ForbiddenException('پرونده‌ای برای این مشخصات یافت نشد.');

    const token = await this.jwt.signAsync(
      { kind: 'record', tenantId, caseId, claimId, sub: insuredId },
      { expiresIn: this.config.get<string>('RECORD_TOKEN_TTL', '10m') },
    );
    await this.audit.record({
      action: AuditAction.OTP_VERIFY,
      targetType: claimId ? 'Claim' : 'Case',
      targetId: (claimId ?? caseId) ?? undefined,
      tenantId,
      actorType: 'INSURED',
    });
    return { token, expiresIn: this.config.get<string>('RECORD_TOKEN_TTL', '10m') };
  }

  /** Pad a National ID to the canonical 10 digits (claims store the deceased NID zero-padded). */
  private nid10(nid: string): string {
    const d = nid.replace(/\D/g, '');
    return d.length > 0 && d.length < 10 ? d.padStart(10, '0') : d;
  }

  /**
   * The deceased's latest claim with this organization. With `companyId` (the requester first picks the
   * بیمه‌گزار company) the match is limited to that company's claims — filed for it, or by one of its
   * representatives.
   */
  private async findClaimByDeceased(tenantId: string, nidHash: string, companyId?: string) {
    const db = this.prisma.unscoped();
    let companyFilter = {};
    if (companyId) {
      const reps = await db.customerAccount.findMany({ where: { companyId }, select: { id: true } });
      companyFilter = { OR: [{ policyholderCompanyId: companyId }, ...(reps.length ? [{ policyHolderId: { in: reps.map((r) => r.id) } }] : [])] };
    }
    return db.claim.findFirst({
      where: { AND: [{ deceasedNationalCodeHash: nidHash, deletedAt: null, OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }] }, companyFilter] },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  }

  /** Trace record: WHO checked (checker phone) and WHAT (queried NID), whether or not a claim matched. */
  private async recordInquiry(tenantId: string, claim: { id: string } | null, checkerPhone: string, nid: string, ip: string) {
    await this.audit.record({
      action: AuditAction.VIEW,
      actorType: 'INSURED',
      tenantId,
      targetType: 'ClaimInquiry',
      targetId: claim?.id,
      metadata: { checkerPhone, deceasedNidLast4: this.nid10(nid).slice(-4), found: !!claim, ip },
    });
  }

  /**
   * استعلام سریع پرونده — look up a death-claim by the DECEASED's National ID and send the OTP to the
   * CHECKER's OWN phone (a beneficiary/stakeholder, not necessarily on file). The checker's phone and
   * the queried National ID are recorded for traceability. Generic response (never reveals existence).
   */
  async requestClaimStatus(dto: RequestOtpDto): Promise<{ ok: true; message: string; otpRequired: boolean }> {
    const tenantId = getTenantIdOrThrow();
    const ctx = getContext();
    const ip = ctx?.ip ?? 'unknown';
    const nidHash = this.crypto.blindIndex(this.nid10(dto.nationalCode))!;
    const phone = this.normalizePhone(dto.phone);
    const phoneHash = this.crypto.blindIndex(phone)!;

    const perIp = Number(this.config.get('RL_OTP_ISSUE_PER_IP_PER_HOUR', 10));
    const perNid = Number(this.config.get('RL_OTP_ISSUE_PER_NID_PER_HOUR', 5));
    if (!this.rateLimit.hit(`cst:ip:${ip}`, perIp, 3600)) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');
    if (!this.rateLimit.hit(`cst:nid:${nidHash}`, perNid, 3600)) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');
    if (!this.rateLimit.hit(`cst:phone:${phoneHash}`, perIp, 3600)) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');

    const claim = await this.findClaimByDeceased(tenantId, nidHash, dto.companyId);
    await this.recordInquiry(tenantId, claim, phone, dto.nationalCode, ip);

    if (!(await this.otpEnabled())) return { ok: true, otpRequired: false, message: 'مشاهده پرونده بدون کد تایید فعال است.' };

    if (claim) {
      const code = this.hash.generateOtp(Number(this.config.get('OTP_LENGTH', 6)));
      const ttl = Number(this.config.get('OTP_TTL_SECONDS', 180));
      await this.prisma.scoped.otpChallenge.create({
        data: { tenantId, purpose: 'inquiry', phoneHash, claimId: claim.id, codeHash: this.hash.hashOtp(code), maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS', 5)), expiresAt: new Date(Date.now() + ttl * 1000) },
      });
      try {
        const pc = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { inquiryUsePlatform: true } });
        if (pc?.inquiryUsePlatform ?? true) await this.sms.sendOtpViaPlatform(dto.phone, code);
        else await this.sms.sendOtp(dto.phone, code, tenantId);
      } catch (e) {
        this.logger.error(`Claim-status OTP send failed (tenant ${tenantId}): ${String(e)}`);
      }
    }
    return { ok: true, otpRequired: true, message: 'در صورت وجود پرونده، کد تایید به شمارهٔ شما ارسال شد.' };
  }

  /** Deceased-NID inquiry when OTP is disabled platform-wide — mints the record token directly. */
  async directClaimStatus(dto: RequestOtpDto): Promise<{ token: string; expiresIn: string }> {
    if (await this.otpEnabled()) throw new ForbiddenException('کد تایید لازم است.');
    const tenantId = getTenantIdOrThrow();
    const ctx = getContext();
    const nidHash = this.crypto.blindIndex(this.nid10(dto.nationalCode))!;
    const claim = await this.findClaimByDeceased(tenantId, nidHash, dto.companyId);
    if (!claim) throw new ForbiddenException('پرونده‌ای برای این مشخصات یافت نشد.');
    const phone = this.normalizePhone(dto.phone);
    await this.recordInquiry(tenantId, claim, phone, dto.nationalCode, ctx?.ip ?? 'unknown');
    const ttl = this.config.get<string>('RECORD_TOKEN_TTL', '10m');
    // `ph` = the requester's phone (encrypted) so «پاسخگوی آنلاین» knows whom to answer.
    const token = await this.jwt.signAsync({ kind: 'record', tenantId, caseId: null, claimId: claim.id, sub: null, ph: this.crypto.encrypt(phone) }, { expiresIn: ttl });
    return { token, expiresIn: ttl };
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
      { kind: 'record', tenantId, caseId: challenge.caseId, claimId: challenge.claimId, sub: challenge.insuredId, ph: this.crypto.encrypt(this.normalizePhone(dto.phone)) },
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

    const insurer = await this.prisma
      .unscoped()
      .tenant.findUnique({ where: { id: c.insurerTenantId }, select: { name: true } });

    // Pull the structured policy/claim field values (نام شرکت، شماره/شروع بیمه‌نامه، سرمایه‌ها، ...).
    const fvals = await this.prisma.unscoped().claimFieldValue.findMany({ where: { claimId }, select: { key: true, value: true } });
    const fv: Record<string, string | null> = {};
    for (const v of fvals) fv[v.key] = v.value;

    await this.audit.record({ action: AuditAction.VIEW, targetType: 'Claim', targetId: claimId, actorType: 'INSURED' });

    const dec = (v: string | null) => (v ? this.crypto.decrypt(v) : null);
    const nid = dec(c.deceasedNationalCode);
    const broker = c.brokerTenantId ? await this.prisma.unscoped().tenant.findUnique({ where: { id: c.brokerTenantId }, select: { name: true, contactHeader: true } }) : null;
    const iban = fv.beneficiary_iban?.replace(/\s/g, '') ?? null;
    // «ویرایش» first: a hand-completed case shows only what the operator typed (its «وضعیت پرونده», its
    // payment date, its own history) — none of the hierarchy's position or hand-offs.
    const story = await this.fields.statusStory(c);
    const manual = story.manual;
    return {
      kind: 'claim',
      claimNumber: c.claimNumber,
      status: c.status,
      claimType: c.claimType,
      insurerName: insurer?.name ?? null,
      deceasedName: dec(c.deceasedFullName),
      nationalCode: nid, // the requester typed it themselves (OTP-verified), so it is shown in full
      nationalCodeMasked: nid,
      birthDate: c.deceasedBirthDate ? toJalali(c.deceasedBirthDate, false) : (fv.birth_date ?? null),
      deceasedAge: ageAt(c.deceasedBirthDate, c.eventDate),
      companyName: fv.company_name ?? c.employerName ?? null,
      policyNumber: fv.policy_number ?? c.policyNumber ?? null,
      policyStartDate: fv.policy_start_date ?? null,
      deathCapital: fv.death_capital ?? null,
      accidentCapital: fv.accident_capital ?? null,
      payableAmount: fv.payable_amount ?? (c.claimedAmount != null ? c.claimedAmount.toString() : null),
      causeOfDeath: fv.cause_of_death ?? c.causeOfDeath ?? null,
      eventDate: c.eventDate ? toJalali(c.eventDate, false) : null,
      createdAt: c.createdAt && !(c.imported && (c.status === 'PAID' || c.status === 'REJECTED')) ? toJalali(c.createdAt, false) : null, // completed imported: only the import date
      description: c.description ?? null,
      caseNotes: fv.case_notes ?? null,
      // «پیگیری آخرین وضعیت»: dates/statuses of every executive step (typed, or implied by the hand-offs)
      stages: Object.fromEntries(Object.entries(await this.fields.effectiveValues(claimId)).filter(([k]) => STAGE_KEYS.has(k))), // «توضیحات پرونده» written by the organizations for the requester
      // تاریخ پرداخت — when the payment was recorded (workflow), else the payment-order date field.
      paidDate: manual ? (fv.payment_order_date ? toPersianDigits(fv.payment_order_date) : null)
        : (() => { const p = (c.steps ?? []).find((s: any) => s.action === 'MARK_PAID' && s.decidedAt); return p?.decidedAt ? toJalali(p.decidedAt, false) : fv.payment_order_date ?? null; })(),
      // Where the claim is now + every hand-off (desk names only — operator names stay internal).
      currentStageLabel: manual ? story.caseStage : c.currentStage ? STAGE_FA[c.currentStage as Stage] : null,
      physicalAtLabel: STAGE_FA[(c.physicalAt as Stage | null) ?? 'POLICYHOLDER'], // where the original documents are
      steps: (manual ? [] : c.steps ?? []).map((s: any) => ({
        order: s.order, partyType: s.partyType, stage: s.stage ?? null, stageLabel: s.stage ? STAGE_FA[s.stage as Stage] : null,
        direction: s.direction, purpose: s.purpose ?? null, state: s.state, action: s.action ?? null, decidedAt: s.decidedAt ? toJalali(s.decidedAt) : null,
      })),
      deficiencies: (c.deficiencies ?? []).map((d: any) => ({ items: this.safeParse(d.items), resolvedAt: d.resolvedAt ? toJalali(d.resolvedAt, false) : null })),
      chain: chainOf(c).map((st) => ({ stage: st, label: STAGE_FA[st] })),
      currentStage: manual ? null : c.currentStage ?? null,
      flowDirection: manual ? null : c.flowDirection ?? null,
      flowPurpose: manual ? null : c.flowPurpose ?? null,
      // ذینفع‌ها — who receives the payment (IBAN masked; names as entered by the organization).
      beneficiaries: {
        type: fv.beneficiary_type ?? c.beneficiaryType ?? null,
        names: fv.beneficiaries ?? null,
        ibanMasked: iban && iban.length > 8 ? `${iban.slice(0, 4)}••••••••${iban.slice(-4)}` : null,
      },
      // تماس و ارتباط — the بیمه‌گزار company (and the brokerage) the requester can contact.
      company: await this.policyholders.contact(c.policyholderCompanyId ?? (await this.companyOfFiler(c.policyHolderId))),
      broker: broker ? { name: broker.name, contact: broker.contactHeader } : null,
      canMessage: !!getContext()?.scopedPhone,
      // «ویرایش» first: a hand-completed case tells its typed story (status + history), else the hierarchy's.
      story,
      imported: !!c.imported,
      // «بررسی وضعیت مدارک»: each required document — uploaded or not, and every desk's decision
      // (none for a hand-completed case). No files or names, only statuses.
      documents: await this.documentStatus(c, manual),
    };
  }

  /** Read-only document checklist of a claim for the inquiry («بررسی وضعیت مدارک»). */
  private async documentStatus(c: { id: string; insurerTenantId: string; claimType: any }, manual: boolean) {
    const db = this.prisma.unscoped();
    const [reqs, docs] = await Promise.all([
      db.requiredDocument.findMany({ where: { tenantId: c.insurerTenantId, isActive: true, appliesToTypes: { has: c.claimType } }, orderBy: { order: 'asc' } }),
      db.document.findMany({ where: { claimId: c.id }, orderBy: { createdAt: 'desc' }, select: { id: true, docCode: true, createdAt: true, verificationStatus: true } }),
    ]);
    const reviews = docs.length && !manual ? await db.documentReview.findMany({ where: { documentId: { in: docs.map((d) => d.id) } } }) : [];
    const latest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (d.docCode && !latest.has(d.docCode)) latest.set(d.docCode, d);
    return reqs.map((r) => {
      const d = latest.get(r.code);
      return {
        label: r.label, uploaded: !!d, uploadedAt: d ? toJalali(d.createdAt) : null, verified: d?.verificationStatus === 'VERIFIED',
        reviews: d ? reviews.filter((x) => x.documentId === d.id).map((x) => ({ stage: x.stage, state: x.state, at: x.updatedAt ? toJalali(x.updatedAt) : null })) : [],
      };
    });
  }

  private async companyOfFiler(policyHolderId: string | null): Promise<string | null> {
    if (!policyHolderId) return null;
    const a = await this.prisma.unscoped().customerAccount.findUnique({ where: { id: policyHolderId }, select: { companyId: true } });
    return a?.companyId ?? null;
  }

  /**
   * «پاسخگوی آنلاین» — the requester leaves a question about the claim they looked up. It reaches the
   * brokerage's inbox and the بیمه‌گزار; they answer the requester on the (OTP-verified) phone.
   */
  async leaveMessage(message: string) {
    const ctx = getContext();
    const claimId = ctx?.scopedClaimId;
    if (!claimId || !ctx?.scopedPhone) throw new ForbiddenException('برای ارسال پیام ابتدا استعلام کنید.');
    const text = String(message ?? '').trim();
    if (text.length < 3) throw new BadRequestException('متن پیام را بنویسید');
    if (!this.rateLimit.hit(`inqmsg:${claimId}:${ctx.scopedPhone}`, 5, 3600)) throw new TooManyRequestsException('تعداد پیام‌ها زیاد است. بعداً تلاش کنید.');
    const c = await this.prisma.unscoped().claim.findUnique({ where: { id: claimId }, select: { id: true, claimNumber: true, brokerTenantId: true, insurerTenantId: true, policyHolderId: true, policyholderCompanyId: true } });
    if (!c) throw new NotFoundException('پرونده یافت نشد.');
    const companyId = c.policyholderCompanyId ?? (await this.companyOfFiler(c.policyHolderId));
    await this.prisma.unscoped().inquiryMessage.create({ data: { claimId, companyId, phone: ctx.scopedPhone, message: text.slice(0, 2000) } });
    const body = `پیام جدید از استعلام‌کنندهٔ پروندهٔ ${c.claimNumber}: «${text.slice(0, 140)}»`;
    const orgId = c.brokerTenantId ?? c.insurerTenantId;
    await this.notifications.notify({ tenantId: orgId, audience: 'ORG', title: 'پاسخگوی آنلاین', body, link: '/org/policyholders?tab=messages' });
    if (c.policyHolderId) {
      const acc = await this.prisma.unscoped().customerAccount.findUnique({ where: { id: c.policyHolderId }, select: { tenantId: true } });
      if (acc) await this.notifications.notify({ tenantId: acc.tenantId, audience: 'CUSTOMER', recipientId: c.policyHolderId, title: 'پاسخگوی آنلاین', body, link: '/customer' });
    }
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'InquiryMessage', targetId: claimId, actorType: 'INSURED' });
    return { ok: true, message: 'پیام شما ثبت شد؛ کارشناس با شمارهٔ موبایل شما تماس خواهد گرفت.' };
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
        nationalCode: nid,
        nationalCodeMasked: nid,
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

/** Executive-step fields the requester may see (dates and statuses only — never IBANs or heirs' details). */
const STAGE_KEYS = new Set([
  'broker_to_insurer_date', 'broker_to_insurer_status', 'death_notice_date', 'death_notice_status', 'execution_stages',
  'docs_request_date', 'docs_request_status', 'docs_receive_date', 'docs_receive_status',
  'missing_docs_request_date', 'missing_docs_request_status', 'case_complete', 'case_complete_date', 'case_complete_status',
  'send_to_hq_date', 'send_to_hq_status', 'council_approve_date', 'council_approve_status',
  'return_to_branch_date', 'return_to_branch_status', 'payment_order_date', 'payment_order_status', 'payment_order', 'case_notes',
]);
