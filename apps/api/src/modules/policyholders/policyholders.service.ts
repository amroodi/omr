import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, InsuranceLine } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { SmsService } from '../auth/sms.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { typesFor } from '../claims/workflow';
import { ModelStore } from '../model-view/model-store.service';
import { TooManyRequestsException } from '../inquiry/http-exceptions';

const LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const LINE_FA: Record<InsuranceLine, string> = { LIFE: 'عمر', ACCIDENT: 'حوادث', LIABILITY: 'مسئولیت', CREDIT_LIFE: 'عمر مانده بدهکار', SAVINGS_LIFE: 'عمر پس‌انداز' };

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
    private readonly sms: SmsService,
    private readonly rateLimit: RateLimitService,
    private readonly store: ModelStore,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  // ── Brokerage (org) side ──
  async list(tenantId: string = getTenantIdOrThrow()) {
    const rows = await this.db().policyholderCompany.findMany({
      where: { tenantId },
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
    const rows = await this.db().inquiryMessage.findMany({ where: { claimId: { in: [...cMap.keys()] }, fromStaff: false }, orderBy: { createdAt: 'desc' }, take: 300 });
    const replies = rows.length ? await this.db().inquiryMessage.findMany({ where: { replyToId: { in: rows.map((m) => m.id) } }, orderBy: { createdAt: 'asc' } }) : [];
    const authors = await this.db().orgUser.findMany({ where: { id: { in: [...new Set(replies.map((x) => x.authorId).filter((x): x is string => !!x))] } }, select: { id: true, displayName: true, username: true } });
    const aMap = new Map(authors.map((a) => [a.id, a.displayName || a.username]));
    const companies = await this.prisma.scoped.policyholderCompany.findMany({ select: { id: true, name: true } });
    const coMap = new Map(companies.map((c) => [c.id, c.name]));
    return rows.map((m) => {
      const phone = this.crypto.decrypt(m.phone) ?? '';
      return {
        id: m.id, claimId: m.claimId, claimNumber: cMap.get(m.claimId)?.claimNumber ?? '—',
        companyName: m.companyId ? (coMap.get(m.companyId) ?? null) : null,
        phone: canPii ? phone : `${phone.slice(0, 4)}•••${phone.slice(-4)}`,
        message: m.message, createdAt: toJalali(m.createdAt), handled: !!m.handledAt,
        replies: replies.filter((x) => x.replyToId === m.id).map((x) => ({ id: x.id, message: x.message, at: toJalali(x.createdAt), by: x.authorId ? (aMap.get(x.authorId) ?? null) : null })),
      };
    });
  }

  /**
   * «گفتگو»: the brokerage answers a requester's question. The answer joins the requester's thread
   * (shown on their next inquiry) and is texted to their verified mobile; the question is marked answered.
   */
  async replyMessage(id: string, text: string) {
    const tenantId = getTenantIdOrThrow();
    const body = String(text ?? '').trim();
    if (body.length < 2) throw new BadRequestException('متن پاسخ را بنویسید');
    const m = await this.db().inquiryMessage.findUnique({ where: { id } });
    const claim = m ? await this.db().claim.findUnique({ where: { id: m.claimId }, select: { brokerTenantId: true, claimNumber: true } }) : null;
    if (!m || m.fromStaff || claim?.brokerTenantId !== tenantId) throw new NotFoundException('پیام یافت نشد');
    // each reply is an SMS to the requester — at most 10 an hour per question
    if (!(await this.rateLimit.hit(`inqreply:${id}`, 10, 3600))) throw new TooManyRequestsException('تعداد پاسخ‌ها به این پیام زیاد است. بعداً تلاش کنید.');
    const actorId = getContext()?.actorId ?? null;
    const phone = this.crypto.decrypt(m.phone) ?? '';
    await this.db().inquiryMessage.create({
      data: { claimId: m.claimId, companyId: m.companyId, phone: m.phone, phoneIdx: m.phoneIdx ?? this.crypto.blindIndex(phone), message: body.slice(0, 2000), fromStaff: true, replyToId: m.id, authorId: actorId },
    });
    await this.db().inquiryMessage.update({ where: { id }, data: { handledAt: new Date(), handledById: actorId } });
    const broker = await this.db().tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    let sms = true;
    try {
      await this.sms.send(phone, `${broker?.name ?? 'کارگزاری'}: پاسخ پیام شما دربارهٔ پروندهٔ ${claim!.claimNumber}: «${body.slice(0, 120)}${body.length > 120 ? '…' : ''}» — متن کامل در «مشاهده سریع و استعلام پرونده»، بخش گفتگو.`, tenantId);
    } catch { sms = false; } // the answer is saved either way; the requester also sees it on the next inquiry
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'InquiryMessage', targetId: id, metadata: { reply: true, sms } });
    return { ok: true, sms };
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
  async network(tenantId: string) {
    const db = this.db();
    const me = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    if (me?.kind !== 'BROKER') throw new BadRequestException('نقشهٔ اتصال‌ها فقط برای کارگزاری است');
    const [broker, companies, parts, allInsurers] = await Promise.all([
      db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true, logoKey: true } }),
      this.list(tenantId),
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
  async setPartner(brokerTenantId: string, insurerTenantId: string, enabled: boolean) {
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
   * claim type, contracts of a line that doesn't cover it are skipped (unlined contracts always fit); with a
   * `line` (the نوع بیمه‌نامه chosen on the panel-1 login), only contracts of that kind count.
   */
  async resolveContract(companyId: string, date: Date | null, claimType: string | null = null, line: InsuranceLine | null = null) {
    const contracts = await this.db().policyholderContract.findMany({ where: { companyId, isActive: true, ...(line ? { line } : {}) } });
    const chain = claimType ? await this.companyChain(companyId) : [];
    const fits = contracts.filter((c) => !claimType || !c.line || typesFor(this.store.get(c.insurerTenantId), c.line, chain).includes(claimType));
    return this.pickContract(fits, date ?? new Date());
  }

  /** The company and its parents: a Model View company group covers a ticked company's subsidiaries. */
  async companyChain(companyId: string): Promise<string[]> {
    const chain: string[] = [];
    for (let id: string | null = companyId; id && !chain.includes(id) && chain.length < 10;) {
      chain.push(id);
      id = (await this.db().policyholderCompany.findUnique({ where: { id }, select: { parentId: true } }))?.parentId ?? null;
    }
    return chain;
  }

  /** A بیمه‌نامه the بیمه‌گزار chose for a new claim: theirs, active, covering the date. The service checks its نوع پرونده. */
  async contractForClaim(companyId: string, contractId: string, date: Date | null) {
    const c = await this.db().policyholderContract.findFirst({ where: { id: contractId, companyId, isActive: true } });
    if (!c) throw new BadRequestException('بیمه‌نامهٔ انتخاب‌شده یافت نشد');
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
