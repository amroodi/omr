import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditAction, CustomerSignupStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { customerClaimWhere, getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { LINE_CLAIM_TYPES, LINE_FA } from '../policyholders/policyholders.service';
import { toAsciiDigits, toJalali } from '../../common/jalali/jalali.util';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Customer dashboard data. A logged-in customer sees only cases where they are the insured or a
 * beneficiary — matched by their nationalCodeHash from the token, within their own tenant.
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private validatePair(nationalCode: string, phone: string): { nid: string; phone: string } {
    const nid = toAsciiDigits(nationalCode).trim();
    const phone2 = toAsciiDigits(phone).trim();
    if (!/^\d{10}$/.test(nid)) throw new BadRequestException('کد ملی باید ۱۰ رقم باشد');
    if (!/^0?9\d{9}$/.test(phone2)) throw new BadRequestException('شماره موبایل نامعتبر است');
    return { nid, phone: phone2 };
  }

  // ── Public self-signup: creates a PENDING account and notifies the org admin ──
  async signup(input: { tenantSlug: string; nationalCode: string; phone: string; fullName?: string }) {
    const { nid, phone } = this.validatePair(input.nationalCode, input.phone);
    const db = this.prisma.unscoped();
    const tenant = await db.tenant.findUnique({ where: { slug: input.tenantSlug.trim() }, select: { id: true, isActive: true, smsConfig: true } });
    if (!tenant || !tenant.isActive) throw new NotFoundException('سازمان یافت نشد');
    const nidHash = this.crypto.blindIndex(nid)!;

    const existing = await db.customerAccount.findFirst({ where: { tenantId: tenant.id, nationalCodeHash: nidHash }, select: { id: true, signupStatus: true } });
    if (existing) {
      if (existing.signupStatus === 'ACTIVE') throw new BadRequestException('شما قبلاً در این سازمان ثبت شده‌اید؛ وارد شوید.');
      if (existing.signupStatus === 'PENDING') throw new BadRequestException('درخواست ثبت‌نام شما قبلاً ارسال شده و در انتظار تایید است.');
      // REJECTED → allow a fresh request.
      await db.customerAccount.update({
        where: { id: existing.id },
        data: { signupStatus: 'PENDING', phone: this.crypto.encrypt(phone), phoneHash: this.crypto.blindIndex(phone), fullName: input.fullName ? this.crypto.encrypt(input.fullName) : null },
      });
    } else {
      await db.customerAccount.create({
        data: {
          tenantId: tenant.id,
          nationalCode: this.crypto.encrypt(nid)!,
          nationalCodeHash: nidHash,
          fullName: input.fullName ? this.crypto.encrypt(input.fullName) : null,
          phone: this.crypto.encrypt(phone),
          phoneHash: this.crypto.blindIndex(phone),
          signupStatus: 'PENDING',
        },
      });
    }
    await this.audit.record({ action: AuditAction.CREATE, tenantId: tenant.id, actorType: 'INSURED', targetType: 'CustomerSignup', metadata: { status: 'PENDING' } });

    // Notify the org (in-panel + SMS to its notify number via its own gateway).
    await this.notifications.notify({
      tenantId: tenant.id,
      audience: 'ORG',
      title: 'درخواست ثبت‌نام بیمه‌گزار',
      body: 'یک بیمه‌گزار درخواست ثبت‌نام داده است؛ برای تایید به پنل مراجعه کنید.',
      link: '/org/policyholders',
    });
    return { ok: true, message: 'درخواست ثبت‌نام ارسال شد. پس از تایید سازمان، امکان ورود خواهید داشت.' };
  }

  async approve(id: string) {
    const tenantId = getTenantIdOrThrow();
    const acc = await this.prisma.scoped.customerAccount.findFirst({ where: { id } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    await this.prisma.scoped.customerAccount.updateMany({ where: { id }, data: { signupStatus: 'ACTIVE', isActive: true } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'CustomerAccount', targetId: id, metadata: { action: 'approve' } });
    await this.notifications.notify({
      tenantId,
      audience: 'CUSTOMER',
      recipientId: id,
      title: 'حساب شما تایید شد',
      body: 'حساب بیمه‌گزار شما تایید شد. اکنون می‌توانید وارد شوید.',
      link: '/customer',
    });
    return { ok: true };
  }

  async reject(id: string) {
    const tenantId = getTenantIdOrThrow();
    await this.prisma.scoped.customerAccount.updateMany({ where: { id }, data: { signupStatus: 'REJECTED', isActive: false } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'CustomerAccount', targetId: id, metadata: { action: 'reject' } });
    await this.notifications.notify({
      tenantId,
      audience: 'CUSTOMER',
      recipientId: id,
      title: 'درخواست ثبت‌نام',
      body: 'درخواست ثبت‌نام شما تایید نشد. برای اطلاعات بیشتر با سازمان تماس بگیرید.',
    });
    return { ok: true };
  }

  /** Active organizations, for the public signup picker. */
  listOrgs() {
    return this.prisma.unscoped().tenant.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { slug: true, name: true } });
  }

  // ── Org-side بیمه‌گزار onboarding (tenant-scoped) ── admin-created accounts are ACTIVE at once
  async createAccount(input: { nationalCode: string; phone: string; fullName?: string; companyId?: string }) {
    const tenantId = getTenantIdOrThrow();
    const { nid, phone } = this.validatePair(input.nationalCode, input.phone);
    const nidHash = this.crypto.blindIndex(nid)!;
    if (await this.prisma.scoped.customerAccount.findFirst({ where: { nationalCodeHash: nidHash } })) {
      throw new BadRequestException('بیمه‌گزار با این کد ملی قبلاً ثبت شده است');
    }
    const acc = await this.prisma.scoped.customerAccount.create({
      data: {
        companyId: input.companyId ? await this.ownCompany(input.companyId) : null,
        tenantId,
        nationalCode: this.crypto.encrypt(nid)!,
        nationalCodeHash: nidHash,
        fullName: input.fullName ? this.crypto.encrypt(input.fullName) : null,
        phone: this.crypto.encrypt(phone),
        phoneHash: this.crypto.blindIndex(phone),
        signupStatus: 'ACTIVE',
      },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'CustomerAccount', targetId: acc.id });
    return { id: acc.id, ok: true };
  }

  private async ownCompany(id: string): Promise<string> {
    const c = await this.prisma.scoped.policyholderCompany.findFirst({ where: { id }, select: { id: true } });
    if (!c) throw new BadRequestException('شرکت بیمه‌گزار یافت نشد');
    return c.id;
  }

  /** The signed-in بیمه‌گزار representative and the company they represent (panel header: name + logo). */
  async me() {
    const ctx = getContext();
    if (ctx?.actorType !== 'CUSTOMER' || !ctx.actorId) throw new ForbiddenException('فقط برای بیمه‌گزار');
    const acc = await this.prisma.unscoped().customerAccount.findUnique({ where: { id: ctx.actorId }, include: { company: true } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const c = acc.company;
    return {
      fullName: acc.fullName ? this.crypto.decrypt(acc.fullName) : null,
      companyLogin: !!ctx.customerCompanyId,
      company: c ? { id: c.id, name: c.name, code: c.code, hasLogo: !!c.logoKey, phone: c.phone, email: c.email, address: c.address, website: c.website, contactName: c.contactName } : null,
    };
  }

  /**
   * The بیمه‌گزار panel home: the company's بیمه‌نامه‌ها (عمر and حوادث, every policy year — newest
   * first, the one in force today pre-selected) and, for the chosen one, its claim totals.
   */
  async dashboard(contractId?: string) {
    const ctx = getContext();
    if (ctx?.actorType !== 'CUSTOMER' || !ctx.actorId) throw new ForbiddenException('فقط برای بیمه‌گزار');
    const db = this.prisma.unscoped();
    const acc = await db.customerAccount.findUnique({ where: { id: ctx.actorId }, include: { company: { include: { contracts: true } }, tenant: { select: { name: true } } } });
    if (!acc) throw new NotFoundException('حساب یافت نشد');
    const co = acc.company;
    const contracts = (co?.contracts ?? []).filter((k) => k.isActive)
      .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0) || (a.line === 'LIFE' ? 0 : 1) - (b.line === 'LIFE' ? 0 : 1));
    const insurerIds = [...new Set(contracts.map((k) => k.insurerTenantId))];
    const insurers = insurerIds.length ? await db.tenant.findMany({ where: { id: { in: insurerIds } }, select: { id: true, name: true } }) : [];
    const iName = new Map(insurers.map((i) => [i.id, i.name]));
    const now = new Date();
    const inForce = (k: { startDate: Date | null; endDate: Date | null }) => (!k.startDate || k.startDate <= now) && (!k.endDate || k.endDate >= now);
    const selected = contracts.find((k) => k.id === contractId) ?? contracts.find(inForce) ?? contracts[0] ?? null;

    let stats = { total: 0, open: 0, waiting: 0, approvedCount: 0, approvedAmount: '0' };
    if (selected) {
      const claims = await db.claim.findMany({
        where: { ...customerClaimWhere(), deletedAt: null, insurerTenantId: selected.insurerTenantId, policyNumber: selected.policyNumber },
        select: { status: true, currentStage: true, claimedAmount: true, finalizedAmount: true },
      });
      const approved = claims.filter((c) => c.status === 'APPROVED' || c.status === 'PAID');
      const sum = approved.reduce((t, c) => t + BigInt(Math.round(Number(c.finalizedAmount ?? c.claimedAmount ?? 0))), 0n);
      stats = {
        total: claims.length,
        open: claims.filter((c) => !['APPROVED', 'PAID', 'REJECTED'].includes(c.status)).length,
        waiting: claims.filter((c) => c.currentStage === 'POLICYHOLDER').length,
        approvedCount: approved.length,
        approvedAmount: sum.toString(),
      };
    }
    return {
      company: co ? { id: co.id, name: co.name, code: co.code, hasLogo: !!co.logoKey } : null,
      brokerName: acc.tenant.name,
      contracts: contracts.map((k) => ({
        id: k.id, line: k.line, lineLabel: k.line ? LINE_FA[k.line] : null, policyNumber: k.policyNumber,
        insurerName: iName.get(k.insurerTenantId) ?? '—',
        startDate: k.startDate ? toJalali(k.startDate, false) : null, endDate: k.endDate ? toJalali(k.endDate, false) : null,
        startIso: k.startDate?.toISOString() ?? null, endIso: k.endDate?.toISOString() ?? null,
        inForce: inForce(k), claimTypes: k.line ? LINE_CLAIM_TYPES[k.line] : null,
      })),
      selectedId: selected?.id ?? null,
      stats,
    };
  }

  async listAccounts(status?: CustomerSignupStatus) {
    // Full National ID / phone are shown only to org users holding view:pii; otherwise masked.
    const canPii = (getContext()?.permissions ?? []).includes('view:pii');
    const rows = await this.prisma.scoped.customerAccount.findMany({
      where: status ? { signupStatus: status } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { company: { select: { id: true, name: true } } },
    });
    return rows.map((r) => {
      const nid = this.crypto.decrypt(r.nationalCode) ?? '';
      const phone = r.phone ? (this.crypto.decrypt(r.phone) ?? '') : '';
      return {
        id: r.id,
        fullName: r.fullName ? this.crypto.decrypt(r.fullName) : null,
        nationalCode: canPii ? nid : null,
        nationalCodeMasked: nid ? `••••••${nid.slice(-4)}` : null,
        phone: canPii ? phone : null,
        phoneMasked: phone ? `••••${phone.slice(-4)}` : null,
        canViewPii: canPii,
        signupStatus: r.signupStatus,
        company: r.company,
        isActive: r.isActive,
        createdAt: toJalali(r.createdAt),
        lastLoginAt: r.lastLoginAt ? toJalali(r.lastLoginAt) : null,
      };
    });
  }

  async pendingCount() {
    return { count: await this.prisma.scoped.customerAccount.count({ where: { signupStatus: 'PENDING' } }) };
  }

  async myCases(): Promise<unknown[]> {
    const nidHash = getContext()?.customerNidHash;
    if (!nidHash) throw new ForbiddenException('توکن نامعتبر است.');

    const cases = await this.prisma.scoped.case.findMany({
      where: {
        OR: [
          { insured: { nationalCodeHash: nidHash } },
          { beneficiary: { nationalCodeHash: nidHash } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        insured: { select: { fullName: true, nationalCode: true } },
        policy: { select: { policyNumber: true, carrier: true, status: true } },
        payments: { orderBy: { date: 'desc' }, take: 5 },
      },
    });

    await this.audit.record({ action: AuditAction.VIEW, targetType: 'CustomerCases', metadata: { count: cases.length } });

    return cases.map((c) => this.present(c));
  }

  private present(c: any): unknown {
    const nid = c.insured?.nationalCode ? this.crypto.decrypt(c.insured.nationalCode) : null;
    return {
      caseNumber: c.caseNumber,
      status: c.status,
      insuredName: c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) : null,
      // The بیمه‌گزار's own cases (they are the insured or the beneficiary): shown in full, not masked.
      nationalCodeMasked: nid,
      nationalCode: nid,
      policy: c.policy ?? null,
      stageDate: c.stageDate ? toJalali(c.stageDate, false) : null,
      paidAt: c.paidAt ? toJalali(c.paidAt, false) : null,
      recentPayments: (c.payments ?? []).map((p: any) => ({
        date: toJalali(p.date, false),
        amount: p.amount?.toString(),
        status: p.status,
      })),
    };
  }
}
