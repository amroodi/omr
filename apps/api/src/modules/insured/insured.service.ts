import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { HashService } from '../../common/crypto/hash.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext } from '../../common/tenant/tenant-context';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { webBase } from '../ai-review/ai-review.queue';
import { SmsService } from '../auth/sms.service';
import { ClaimsService } from '../claims/claims.service';
import { ModelStore } from '../model-view/model-store.service';
import { beneficiaryHiddenDoc } from '../required-docs/defaults';
import { SessionsService } from '../security/sessions.service';

const OTP_PURPOSE = 'insured-panel';
const STATUS_FA: Record<string, string> = { PAID: 'پرداخت شده', REJECTED: 'رد شده' };

export const normPhone = (raw: string) => raw.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s-]/g, '').replace(/^(\+98|0098)/, '0');

/**
 * «پنل بیمه‌شده»: the insured or a dependent signs in with a mobile the بیمه‌گزار / نماینده invited, sees
 * those cases' progress and uploads only the documents Model View names. Access is re-checked on every request.
 */
@Injectable()
export class InsuredService {
  private readonly logger = new Logger(InsuredService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly hash: HashService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly store: ModelStore,
    private readonly claims: ClaimsService,
  ) {}

  private db() { return this.prisma.unscoped(); }

  private validPhone(raw: string) {
    const phone = normPhone(raw ?? '');
    if (!/^09\d{9}$/.test(phone)) throw new BadRequestException('شماره موبایل نامعتبر است');
    return phone;
  }

  /** Live invitations of this mobile, on insurers that have the panel on. */
  private async accesses(phoneHash: string) {
    const rows = await this.db().claimInsuredAccess.findMany({
      where: { phoneHash, revokedAt: null, expiresAt: { gt: new Date() }, claim: { deletedAt: null } },
      include: { claim: true }, orderBy: { createdAt: 'desc' },
    });
    const out: typeof rows = [];
    for (const r of rows) if ((await this.store.load(r.claim.insurerTenantId)).insured.enabled) out.push(r);
    return out;
  }

  /** The panel exists only once Model View switches it on for at least one insurer; off by default. */
  async anyEnabled() {
    const rows = await this.db().tenant.findMany({ where: { kind: 'INSURER', workflowModel: { not: null as any } }, select: { id: true } });
    for (const r of rows) if ((await this.store.load(r.id)).insured.enabled) return true;
    return false;
  }
  private async assertOn() {
    if (!(await this.anyEnabled())) throw new NotFoundException('یافت نشد');
  }

  // ── Sign-in ──
  /** Same answer whether or not the mobile was invited, so nobody can test numbers. */
  async requestOtp(rawPhone: string) {
    await this.assertOn();
    const phone = this.validPhone(rawPhone);
    const ip = getContext()?.ip ?? '';
    if (!(await this.rateLimit.hit(`insuredotp:ip:${ip}`, 20, 3600)) || !(await this.rateLimit.hit(`insuredotp:ph:${phone}`, 5, 3600))) {
      throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید');
    }
    const ok = { ok: true, message: 'اگر این شماره به پرونده‌ای دعوت شده باشد، کد ورود پیامک می‌شود.' };
    const phoneHash = this.crypto.blindIndex(phone)!;
    const [first] = await this.accesses(phoneHash);
    if (!first) return ok;
    const code = this.hash.generateOtp(Number(this.config.get('OTP_LENGTH', 6)));
    await this.db().otpChallenge.create({ data: {
      tenantId: first.claim.insurerTenantId, purpose: OTP_PURPOSE, phoneHash, codeHash: this.hash.hashOtp(code),
      maxAttempts: Number(this.config.get('OTP_MAX_ATTEMPTS', 5)),
      expiresAt: new Date(Date.now() + Number(this.config.get('OTP_TTL_SECONDS', 180)) * 1000),
    } });
    await this.sms.sendOtpViaPlatform(phone, code).catch((e) => this.logger.error(`Insured OTP send failed: ${String(e)}`));
    await this.audit.record({ action: AuditAction.OTP_ISSUE, tenantId: first.claim.insurerTenantId, actorType: 'INSURED', metadata: { realm: 'insured' } });
    return ok;
  }

  async verifyOtp(rawPhone: string, code: string) {
    await this.assertOn();
    const phone = this.validPhone(rawPhone);
    if (!(await this.rateLimit.hit(`insuredverify:ip:${getContext()?.ip ?? ''}`, 30, 600))) throw new TooManyRequestsException('تعداد تلاش‌ها زیاد است');
    const phoneHash = this.crypto.blindIndex(phone)!;
    const db = this.db();
    const ch = await db.otpChallenge.findFirst({ where: { phoneHash, purpose: OTP_PURPOSE, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!ch || ch.attempts >= ch.maxAttempts) throw new ForbiddenException('کد نامعتبر یا منقضی شده است.');
    if (!this.hash.verifyOtp(ch.codeHash, String(code ?? ''))) {
      await db.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw new ForbiddenException('کد نامعتبر است.');
    }
    await db.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    const [first] = await this.accesses(phoneHash);
    if (!first) throw new ForbiddenException('دسترسی فعالی برای این شماره نیست.');
    const label = first.fullName ? this.crypto.decrypt(first.fullName) : null;
    const sid = await this.sessions.start({ realm: 'INSURED', actorId: phoneHash, actorLabel: `بیمه‌شده: ${label ?? `${phone.slice(0, 4)}•••${phone.slice(-3)}`}`, tenantId: first.claim.insurerTenantId });
    const token = await this.jwt.signAsync({ kind: 'insured', sub: phoneHash, sid }, { expiresIn: '8h' });
    return { token };
  }

  // ── The panel ──
  private me() {
    const h = getContext()?.insuredPhoneHash;
    if (!h) throw new ForbiddenException('دسترسی ندارید');
    return h;
  }

  /** Each invited case: where it is, and only the documents this person handles. */
  async cases() {
    const rows = await this.accesses(this.me());
    const seen = new Set<string>();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.claimId)) continue;
      seen.add(r.claimId);
      const c = r.claim;
      const m = this.store.get(c.insurerTenantId);
      const hidden = beneficiaryHiddenDoc(c.beneficiaryType);
      const reqs = await this.db().requiredDocument.findMany({
        where: { tenantId: c.insurerTenantId, isActive: true, appliesToTypes: { has: c.claimType }, code: { in: m.insured.docCodes.filter((x) => x !== hidden) } },
        orderBy: { order: 'asc' }, select: { code: true, label: true },
      });
      const docs = await this.db().document.findMany({ where: { claimId: c.id, docCode: { in: reqs.map((x) => x.code) } }, orderBy: { createdAt: 'desc' }, select: { docCode: true, fileName: true, verificationStatus: true, aiStatus: true, aiReason: true, verificationNote: true } });
      out.push({
        id: c.id, claimNumber: c.claimNumber, claimType: c.claimType, claimTypeLabel: m.form.caseTypes.find((t) => t.code === c.claimType)?.label ?? c.claimType, closed: c.status === 'PAID' || c.status === 'REJECTED',
        where: STATUS_FA[c.status] ?? (c.currentStage ? `نزد ${m.stages[c.currentStage].label}` : '—'),
        accessUntil: r.expiresAt.toISOString(),
        documents: reqs.map((x) => {
          const d = docs.find((y) => y.docCode === x.code);
          const refused = d?.aiStatus === 'MISMATCH' || d?.verificationStatus === 'REJECTED';
          return { ...x, fileName: d?.fileName ?? null, state: !d ? 'MISSING' : refused ? 'REFUSED' : d.verificationStatus === 'VERIFIED' ? 'APPROVED' : 'SENT', reason: refused ? d?.aiReason ?? d?.verificationNote ?? null : null };
        }),
      });
    }
    return out;
  }

  async upload(claimId: string, docCode: string, file: Express.Multer.File) {
    const phoneHash = this.me();
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    const access = (await this.accesses(phoneHash)).find((r) => r.claimId === claimId);
    if (!access) throw new NotFoundException('پرونده یافت نشد');
    const c = access.claim;
    if (c.status === 'PAID' || c.status === 'REJECTED') throw new BadRequestException('این پرونده بسته شده است');
    const m = this.store.get(c.insurerTenantId);
    if (!m.insured.docCodes.includes(docCode) || beneficiaryHiddenDoc(c.beneficiaryType) === docCode) throw new ForbiddenException('بارگذاری این مدرک از این پنل مجاز نیست');
    if (!(await this.rateLimit.hit(`insuredup:${access.id}`, 30, 3600))) throw new TooManyRequestsException('تعداد بارگذاری‌ها زیاد است. بعداً تلاش کنید');
    const phone = this.crypto.decrypt(access.phone);
    const doc = await this.claims.storeInsuredDocument(c, file, docCode, phone);
    await this.audit.record({ action: AuditAction.CREATE, tenantId: c.insurerTenantId, actorType: 'INSURED', targetType: 'ClaimDocument', targetId: doc.id, metadata: { claimId, docCode, via: 'insured-panel' } });
    return { ok: true };
  }

  // ── Invitations (from the بیمه‌گزار / نماینده panel; the case's access check is done by the caller) ──
  async invites(claimId: string) {
    const rows = await this.db().claimInsuredAccess.findMany({ where: { claimId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => {
      const p = this.crypto.decrypt(r.phone) ?? '';
      return { id: r.id, fullName: r.fullName ? this.crypto.decrypt(r.fullName) : null, phone: `${p.slice(0, 4)}•••${p.slice(-3)}`, expiresAt: r.expiresAt.toISOString() };
    });
  }

  async invite(claim: { id: string; claimNumber: string; insurerTenantId: string; brokerTenantId: string | null; status: string }, rawPhone: string, fullName?: string) {
    const { insured } = await this.store.load(claim.insurerTenantId);
    if (!insured.enabled) throw new ForbiddenException('پنل بیمه‌شده برای این بیمه‌گر فعال نیست');
    if (claim.status === 'PAID' || claim.status === 'REJECTED') throw new BadRequestException('این پرونده بسته شده است');
    const phone = this.validPhone(rawPhone);
    if (!(await this.rateLimit.hit(`insuredinvite:${claim.id}`, 10, 3600))) throw new TooManyRequestsException('تعداد دعوت‌ها زیاد است. بعداً تلاش کنید');
    const phoneHash = this.crypto.blindIndex(phone)!;
    const db = this.db();
    const name = fullName?.trim() ? this.crypto.encrypt(fullName.trim()) : null;
    const expiresAt = new Date(Date.now() + insured.linkDays * 86_400_000);
    const cur = await db.claimInsuredAccess.findFirst({ where: { claimId: claim.id, phoneHash, revokedAt: null } });
    const row = cur
      ? await db.claimInsuredAccess.update({ where: { id: cur.id }, data: { expiresAt, fullName: name ?? cur.fullName } })
      : await db.claimInsuredAccess.create({ data: { claimId: claim.id, phoneHash, phone: this.crypto.encrypt(phone)!, fullName: name, invitedById: getContext()?.actorId ?? null, expiresAt } });
    await this.sms.send(phone, `برای بارگذاری مدارک پروندهٔ ${claim.claimNumber} با همین شماره وارد شوید: ${webBase()}/insured/login`, claim.brokerTenantId ?? claim.insurerTenantId);
    await this.audit.record({ action: AuditAction.CREATE, tenantId: claim.insurerTenantId, targetType: 'ClaimInsuredAccess', targetId: row.id, metadata: { claimId: claim.id } });
    return { ok: true };
  }

  async revoke(claim: { id: string; insurerTenantId: string }, accessId: string) {
    const n = await this.db().claimInsuredAccess.updateMany({ where: { id: accessId, claimId: claim.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!n.count) throw new NotFoundException('دسترسی یافت نشد');
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimInsuredAccess', targetId: accessId, metadata: { revoked: true } });
    return { ok: true };
  }
}
