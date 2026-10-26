import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimType, InsuranceLine } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Which claim types each policy line covers: عمر pays on death (any cause) and illness disability; حوادث on accidents. */
export const LINE_CLAIM_TYPES: Record<InsuranceLine, ClaimType[]> = {
  LIFE: ['DEATH_ILLNESS', 'DEATH_ACCIDENT', 'DISABILITY_ILLNESS'],
  ACCIDENT: ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT'],
};
export const LINE_FA: Record<InsuranceLine, string> = { LIFE: 'عمر', ACCIDENT: 'حوادث' };

export interface CompanyInput {
  name?: string;
  parentId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
  contactName?: string | null;
  isActive?: boolean;
}

export interface ContractInput {
  insurerTenantId?: string;
  line?: InsuranceLine | null;
  policyNumber?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  isActive?: boolean;
}

/**
 * بیمه‌گزار companies served by a brokerage, and their insurer contracts. The brokerage decides
 * (and may change at any time) which insurer covers each company for which period; a claim filed for
 * a company is routed to the contract that covered the date of death (see resolveContract).
 */
@Injectable()
export class PolicyholdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  // ── Brokerage (org) side ──
  async list() {
    const rows = await this.prisma.scoped.policyholderCompany.findMany({
      orderBy: { name: 'asc' },
      include: { contracts: { orderBy: { startDate: 'desc' } }, _count: { select: { accounts: true } } },
    });
    const insurerIds = [...new Set(rows.flatMap((r) => r.contracts.map((c) => c.insurerTenantId)))];
    const insurers = insurerIds.length ? await this.db().tenant.findMany({ where: { id: { in: insurerIds } }, select: { id: true, name: true } }) : [];
    const iMap = new Map(insurers.map((i) => [i.id, i.name]));
    const now = new Date();
    return rows.map((r) => {
      const current = this.pickContract(r.contracts, now);
      return {
        id: r.id, name: r.name, code: r.code, hasPassword: !!r.passwordHash, parentId: r.parentId, phone: r.phone, email: r.email, address: r.address, website: r.website,
        contactName: r.contactName, isActive: r.isActive, hasLogo: !!r.logoKey, accounts: r._count.accounts,
        currentInsurer: current ? { id: current.insurerTenantId, name: iMap.get(current.insurerTenantId) ?? '—' } : null,
        contracts: r.contracts.map((c) => ({
          id: c.id, insurerTenantId: c.insurerTenantId, insurerName: iMap.get(c.insurerTenantId) ?? '—', policyNumber: c.policyNumber,
          line: c.line, lineLabel: c.line ? LINE_FA[c.line] : null,
          startDate: c.startDate ? toJalali(c.startDate, false) : null, endDate: c.endDate ? toJalali(c.endDate, false) : null,
          startIso: c.startDate?.toISOString() ?? null, endIso: c.endDate?.toISOString() ?? null,
          isActive: c.isActive, note: c.note, isCurrent: current?.id === c.id,
        })),
      };
    });
  }

  async create(input: CompanyInput) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('نام شرکت بیمه‌گزار الزامی است');
    if (input.parentId) await this.own(input.parentId);
    const c = await this.prisma.scoped.policyholderCompany.create({
      data: { tenantId: getTenantIdOrThrow(), name, ...this.clean(input), parentId: input.parentId ?? null },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'PolicyholderCompany', targetId: c.id, metadata: { name } });
    return c;
  }

  async update(id: string, input: CompanyInput) {
    await this.own(id);
    if (input.parentId) {
      if (input.parentId === id) throw new BadRequestException('شرکت نمی‌تواند زیرمجموعهٔ خودش باشد');
      await this.own(input.parentId);
    }
    await this.prisma.scoped.policyholderCompany.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...this.clean(input),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'PolicyholderCompany', targetId: id, metadata: input as Record<string, unknown> });
    return { ok: true };
  }

  async uploadLogo(id: string, file: Express.Multer.File) {
    await this.own(id);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (!LOGO_MIME.has(file.mimetype)) throw new BadRequestException('لوگو باید PNG، JPG یا WEBP باشد');
    const key = await this.storage.save(getTenantIdOrThrow(), file.buffer);
    await this.prisma.scoped.policyholderCompany.update({ where: { id }, data: { logoKey: `${key}|${file.mimetype}` } });
    await this.audit.record({ action: AuditAction.UPLOAD, targetType: 'PolicyholderCompanyLogo', targetId: id });
    return { ok: true };
  }

  async addContract(companyId: string, input: ContractInput) {
    await this.own(companyId);
    if (!input.insurerTenantId) throw new BadRequestException('بیمه‌گر را انتخاب کنید');
    await this.assertPartner(input.insurerTenantId);
    const range = this.range(input);
    const c = await this.db().policyholderContract.create({
      data: { companyId, insurerTenantId: input.insurerTenantId, line: input.line ?? null, policyNumber: input.policyNumber?.trim() || null, note: input.note?.trim() || null, ...range },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'PolicyholderContract', targetId: c.id, metadata: { companyId, insurerTenantId: input.insurerTenantId } });
    return c;
  }

  async updateContract(companyId: string, contractId: string, input: ContractInput) {
    await this.own(companyId);
    const c = await this.db().policyholderContract.findFirst({ where: { id: contractId, companyId } });
    if (!c) throw new NotFoundException('قرارداد یافت نشد');
    if (input.insurerTenantId) await this.assertPartner(input.insurerTenantId);
    await this.db().policyholderContract.update({
      where: { id: contractId },
      data: {
        ...(input.insurerTenantId ? { insurerTenantId: input.insurerTenantId } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.policyNumber !== undefined ? { policyNumber: input.policyNumber?.trim() || null } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.startDate !== undefined || input.endDate !== undefined ? this.range({ startDate: input.startDate ?? c.startDate?.toISOString(), endDate: input.endDate === undefined ? c.endDate?.toISOString() : input.endDate }) : {}),
      },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'PolicyholderContract', targetId: contractId, metadata: input as Record<string, unknown> });
    return { ok: true };
  }

  /** Attach a بیمه‌گزار representative (CustomerAccount) to a company, or detach with null. */
  async assignAccount(accountId: string, companyId: string | null) {
    const acc = await this.prisma.scoped.customerAccount.findFirst({ where: { id: accountId }, select: { id: true } });
    if (!acc) throw new NotFoundException('حساب بیمه‌گزار یافت نشد');
    if (companyId) await this.own(companyId);
    await this.prisma.scoped.customerAccount.update({ where: { id: accountId }, data: { companyId } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'CustomerAccount', targetId: accountId, metadata: { companyId } });
    return { ok: true };
  }

  /** «پاسخگوی آنلاین» questions left on this brokerage's claims, newest first. */
  async messages() {
    const tenantId = getTenantIdOrThrow();
    const canPii = (getContext()?.permissions ?? []).includes('view:pii');
    const claims = await this.db().claim.findMany({ where: { brokerTenantId: tenantId }, select: { id: true, claimNumber: true, policyholderCompanyId: true } });
    const cMap = new Map(claims.map((c) => [c.id, c]));
    const rows = await this.db().inquiryMessage.findMany({ where: { claimId: { in: [...cMap.keys()] } }, orderBy: { createdAt: 'desc' }, take: 300 });
    const companies = await this.prisma.scoped.policyholderCompany.findMany({ select: { id: true, name: true } });
    const coMap = new Map(companies.map((c) => [c.id, c.name]));
    return rows.map((m) => {
      const phone = this.crypto.decrypt(m.phone) ?? '';
      return {
        id: m.id, claimId: m.claimId, claimNumber: cMap.get(m.claimId)?.claimNumber ?? '—',
        companyName: m.companyId ? (coMap.get(m.companyId) ?? null) : null,
        phone: canPii ? phone : `${phone.slice(0, 4)}•••${phone.slice(-4)}`,
        message: m.message, createdAt: toJalali(m.createdAt), handled: !!m.handledAt,
      };
    });
  }

  async markMessageHandled(id: string) {
    const tenantId = getTenantIdOrThrow();
    const m = await this.db().inquiryMessage.findUnique({ where: { id } });
    const claim = m ? await this.db().claim.findUnique({ where: { id: m.claimId }, select: { brokerTenantId: true } }) : null;
    if (!m || claim?.brokerTenantId !== tenantId) throw new NotFoundException('پیام یافت نشد');
    await this.db().inquiryMessage.update({ where: { id }, data: { handledAt: new Date(), handledById: getContext()?.actorId ?? null } });
    return { ok: true };
  }

  // ── Connection map: بیمه‌گزار → کارگزاری → بیمه‌گر ──
  /**
   * Everything the «نقشهٔ اتصال‌ها» view needs: this brokerage, its بیمه‌گزار companies (with their
   * contracts), the insurers it works with, and the platform's other insurers it could add.
   */
  async network() {
    const tenantId = getTenantIdOrThrow();
    const db = this.db();
    const [broker, companies, parts, allInsurers] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true, logoKey: true } }),
      this.list(),
      db.brokerInsurerPartnership.findMany({ where: { brokerTenantId: tenantId } }),
      db.tenant.findMany({ where: { kind: 'INSURER', isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, logoKey: true, primaryColor: true, theme: true } }),
    ]);
    const active = new Set(parts.filter((p) => p.isActive).map((p) => p.insurerTenantId));
    const color = (t: { primaryColor: string; theme: unknown }) => ((t.theme as any)?.brand as string | undefined) ?? t.primaryColor;
    const routed = (insurerId: string) => companies.filter((c) => c.currentInsurer?.id === insurerId).length;
    return {
      broker: { name: broker?.name ?? '', slug: broker?.slug ?? '', hasLogo: !!broker?.logoKey },
      companies,
      insurers: allInsurers.filter((i) => active.has(i.id)).map((i) => ({ id: i.id, name: i.name, slug: i.slug, hasLogo: !!i.logoKey, color: color(i), companies: routed(i.id) })),
      available: allInsurers.filter((i) => !active.has(i.id)).map((i) => ({ id: i.id, name: i.name })),
    };
  }

  /** Connect this brokerage to an insurer registered on the platform (or end the cooperation). */
  async setPartner(insurerTenantId: string, enabled: boolean) {
    const brokerTenantId = getTenantIdOrThrow();
    const db = this.db();
    const ins = await db.tenant.findUnique({ where: { id: insurerTenantId }, select: { kind: true, isActive: true } });
    if (!ins || ins.kind !== 'INSURER' || !ins.isActive) throw new BadRequestException('بیمه‌گر نامعتبر است');
    if (!enabled) {
      const inUse = await db.policyholderContract.count({ where: { insurerTenantId, isActive: true, company: { tenantId: brokerTenantId } } });
      if (inUse) throw new BadRequestException(`${inUse.toLocaleString('fa-IR')} قرارداد فعال بیمه‌گزار با این بیمه‌گر دارید؛ ابتدا آن‌ها را غیرفعال کنید یا به بیمه‌گر دیگری منتقل کنید.`);
    }
    await db.brokerInsurerPartnership.upsert({
      where: { brokerTenantId_insurerTenantId: { brokerTenantId, insurerTenantId } },
      update: { isActive: enabled },
      create: { brokerTenantId, insurerTenantId, isActive: enabled },
    });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'BrokerInsurerPartnership', targetId: insurerTenantId, metadata: { enabled } });
    return { ok: true };
  }

  // ── Public / routing ──
  /** Public company search for the استعلام form (needs ≥2 letters; at most 10 names — no full client list). */
  async search(q: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.scoped.policyholderCompany.findMany({
      where: { isActive: true, name: { contains: term, mode: 'insensitive' } },
      orderBy: { name: 'asc' }, take: 10, select: { id: true, name: true, logoKey: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, hasLogo: !!r.logoKey }));
  }

  async logo(id: string): Promise<{ buffer: Buffer; mime: string }> {
    const c = await this.db().policyholderCompany.findUnique({ where: { id }, select: { logoKey: true } });
    if (!c?.logoKey) throw new NotFoundException('لوگو ثبت نشده است');
    const i = c.logoKey.lastIndexOf('|');
    return { buffer: await this.storage.read(c.logoKey.slice(0, i)), mime: c.logoKey.slice(i + 1) };
  }

  /** Public contact card of a company (shown to people who looked a claim up). */
  async contact(id: string | null | undefined) {
    if (!id) return null;
    const c = await this.db().policyholderCompany.findUnique({ where: { id } });
    if (!c) return null;
    return { id: c.id, name: c.name, hasLogo: !!c.logoKey, phone: c.phone, email: c.email, address: c.address, website: c.website, contactName: c.contactName };
  }

  /**
   * The insurer contract that covered `date` (latest start wins); used to route a new claim. With a
   * claim type, contracts of a line that doesn't cover it are skipped (unlined contracts always fit).
   */
  async resolveContract(companyId: string, date: Date | null, claimType: ClaimType | null = null) {
    const contracts = await this.db().policyholderContract.findMany({ where: { companyId, isActive: true } });
    const fits = contracts.filter((c) => !claimType || !c.line || LINE_CLAIM_TYPES[c.line].includes(claimType));
    return this.pickContract(fits, date ?? new Date());
  }

  /** A بیمه‌نامه the بیمه‌گزار chose for a new claim: theirs, active, of a fitting line, covering the date. */
  async contractForClaim(companyId: string, contractId: string, claimType: ClaimType | null, date: Date | null) {
    const c = await this.db().policyholderContract.findFirst({ where: { id: contractId, companyId, isActive: true } });
    if (!c) throw new BadRequestException('بیمه‌نامهٔ انتخاب‌شده یافت نشد');
    if (claimType && c.line && !LINE_CLAIM_TYPES[c.line].includes(claimType)) {
      throw new BadRequestException(`نوع خسارت انتخاب‌شده در بیمه‌نامهٔ ${LINE_FA[c.line]} پوشش داده نمی‌شود`);
    }
    if (date && ((c.startDate && date < c.startDate) || (c.endDate && date > c.endDate))) {
      throw new BadRequestException(`تاریخ وقوع در دورهٔ این بیمه‌نامه (${c.startDate ? toJalali(c.startDate, false) : '…'} تا ${c.endDate ? toJalali(c.endDate, false) : '…'}) نیست؛ بیمه‌نامهٔ همان سال را انتخاب کنید.`);
    }
    return c;
  }

  private pickContract<T extends { startDate: Date | null; endDate: Date | null; isActive: boolean }>(contracts: T[], at: Date): T | null {
    const covering = contracts.filter((c) => c.isActive && (!c.startDate || c.startDate <= at) && (!c.endDate || c.endDate >= at));
    covering.sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));
    return covering[0] ?? null;
  }

  // ── helpers ──
  private async own(id: string) {
    const c = await this.prisma.scoped.policyholderCompany.findFirst({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
  }

  private async assertPartner(insurerTenantId: string) {
    const p = await this.db().brokerInsurerPartnership.findFirst({ where: { brokerTenantId: getTenantIdOrThrow(), insurerTenantId, isActive: true }, select: { id: true } });
    if (!p) throw new BadRequestException('این کارگزاری با این بیمه‌گر همکاری فعال ندارد');
  }

  private range(input: { startDate?: string | null; endDate?: string | null }) {
    const startDate = input.startDate ? new Date(input.startDate) : null;
    const endDate = input.endDate ? new Date(input.endDate) : null;
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('تاریخ پایان قرارداد قبل از تاریخ شروع است');
    return { startDate, endDate };
  }

  private clean(input: CompanyInput) {
    const t = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    const out: Record<string, string | null> = {};
    for (const k of ['phone', 'email', 'address', 'website', 'contactName'] as const) {
      const v = t(input[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
}
