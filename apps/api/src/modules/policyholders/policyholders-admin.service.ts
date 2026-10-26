import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, InsuranceLine } from '@prisma/client';
import { randomInt } from 'crypto';
import * as ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { fromJalali, toAsciiDigits, toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LINE_FA } from './policyholders.service';

/** Arabic ي/ك → Persian ی/ک, ZWNJ/extra spaces folded — the export uses Arabic letters. */
const fa = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
/** "نيرو صنعت سرچشمه کد 7096232" → name + کد بیمه‌گزار. */
const NAME_CODE = /^(.*?)\s*کد\s*[:：]?\s*([0-9۰-۹]+)\s*$/;
// No 0/O, 1/l/I — passwords get read out over the phone.
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface ImportResult {
  sheets: { name: string; line: InsuranceLine; rows: number }[];
  companiesCreated: number;
  companiesUpdated: number;
  contractsCreated: number;
  contractsUpdated: number;
  contractsSkipped: number;
  errors: { sheet: string; row: number; message: string }[];
  /** Passwords generated in this import (companies that had none) — shown once, never stored in clear. */
  credentials: { code: string; name: string; password: string }[];
}

/**
 * Super-admin side of بیمه‌گزار companies: the list across brokerages, the yearly policy import from
 * the insurer's Excel export (sheets «عمر جاری» / «حوادث جاری»), panel passwords and policy years.
 */
@Injectable()
export class PolicyholdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly audit: AuditService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  /** Brokerages (that own companies) and insurers, for the page's pickers. */
  async options() {
    const tenants = await this.db().tenant.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true, kind: true } });
    return { brokers: tenants.filter((t) => t.kind === 'BROKER'), insurers: tenants.filter((t) => t.kind === 'INSURER') };
  }

  async list(brokerTenantId?: string, q?: string) {
    const term = fa(toAsciiDigits(q ?? ''));
    const rows = await this.db().policyholderCompany.findMany({
      where: {
        ...(brokerTenantId ? { tenantId: brokerTenantId } : {}),
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { code: { contains: term } }, { contracts: { some: { policyNumber: term } } }] } : {}),
      },
      orderBy: { name: 'asc' },
      include: { contracts: { orderBy: [{ startDate: 'desc' }, { line: 'asc' }] } },
      take: 1000,
    });
    const tIds = [...new Set([...rows.map((r) => r.tenantId), ...rows.flatMap((r) => r.contracts.map((c) => c.insurerTenantId))])];
    const tenants = tIds.length ? await this.db().tenant.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true } }) : [];
    const tName = new Map(tenants.map((t) => [t.id, t.name]));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id, name: r.name, code: r.code, isActive: r.isActive, brokerTenantId: r.tenantId, brokerName: tName.get(r.tenantId) ?? '—',
      hasPassword: !!r.passwordHash, passwordSetAt: r.passwordSetAt ? toJalali(r.passwordSetAt) : null,
      lines: [...new Set(r.contracts.filter((c) => c.isActive && c.line).map((c) => c.line as InsuranceLine))],
      contracts: r.contracts.map((c) => ({
        id: c.id, line: c.line, lineLabel: c.line ? LINE_FA[c.line] : null, policyNumber: c.policyNumber,
        insurerTenantId: c.insurerTenantId, insurerName: tName.get(c.insurerTenantId) ?? '—',
        startDate: c.startDate ? toJalali(c.startDate, false) : null, endDate: c.endDate ? toJalali(c.endDate, false) : null,
        isActive: c.isActive, inForce: c.isActive && (!c.startDate || c.startDate <= now) && (!c.endDate || c.endDate >= now),
      })),
    }));
  }

  async create(input: { brokerTenantId: string; name: string; code: string }) {
    const broker = await this.db().tenant.findUnique({ where: { id: input.brokerTenantId }, select: { kind: true } });
    if (broker?.kind !== 'BROKER') throw new BadRequestException('کارگزاری نامعتبر است');
    const code = toAsciiDigits(input.code).trim();
    if (await this.db().policyholderCompany.findFirst({ where: { tenantId: input.brokerTenantId, code } })) throw new BadRequestException('این کد بیمه‌گزار قبلاً ثبت شده است');
    const c = await this.db().policyholderCompany.create({ data: { tenantId: input.brokerTenantId, name: fa(input.name), code }, select: { id: true } });
    await this.audit.record({ action: AuditAction.CREATE, tenantId: input.brokerTenantId, targetType: 'PolicyholderCompany', targetId: c.id, metadata: { code, by: 'super' } });
    return c;
  }

  async update(id: string, input: { name?: string; code?: string; isActive?: boolean }) {
    const co = await this.company(id);
    const code = input.code !== undefined ? toAsciiDigits(input.code).trim() : undefined;
    if (code && code !== co.code && (await this.db().policyholderCompany.findFirst({ where: { tenantId: co.tenantId, code } }))) {
      throw new BadRequestException('این کد بیمه‌گزار قبلاً ثبت شده است');
    }
    await this.db().policyholderCompany.update({
      where: { id },
      data: { ...(input.name ? { name: fa(input.name) } : {}), ...(code !== undefined ? { code: code || null } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
    });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: co.tenantId, targetType: 'PolicyholderCompany', targetId: id, metadata: { ...input, by: 'super' } });
    return { ok: true };
  }

  /** Set (or generate) the panel password of a company. The new password is returned once. */
  async setPassword(id: string, password?: string) {
    const co = await this.company(id);
    if (!co.code) throw new BadRequestException('ابتدا کد بیمه‌گزار را ثبت کنید');
    const pw = password?.trim() || this.newPassword();
    if (pw.length < 8) throw new BadRequestException('رمز عبور باید دست‌کم ۸ نویسه باشد');
    await this.db().policyholderCompany.update({ where: { id }, data: { passwordHash: await this.hash.hashPassword(pw), passwordSetAt: new Date() } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: co.tenantId, targetType: 'PolicyholderPassword', targetId: id, metadata: { by: 'super' } });
    return { code: co.code, name: co.name, password: pw };
  }

  /** Add a policy year (a new بیمه‌نامه number, usually issued yearly by the insurer). */
  async addContract(id: string, input: { insurerTenantId: string; line: InsuranceLine; policyNumber: string; startDate?: string | null; endDate?: string | null }) {
    const co = await this.company(id);
    await this.assertInsurer(input.insurerTenantId);
    await this.ensurePartnership(co.tenantId, input.insurerTenantId);
    const startDate = input.startDate ? new Date(input.startDate) : null;
    const endDate = input.endDate ? new Date(input.endDate) : null;
    if (startDate && endDate && endDate < startDate) throw new BadRequestException('تاریخ پایان قبل از تاریخ شروع است');
    const c = await this.db().policyholderContract.create({
      data: { companyId: id, insurerTenantId: input.insurerTenantId, line: input.line, policyNumber: toAsciiDigits(input.policyNumber).trim(), startDate, endDate },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, tenantId: co.tenantId, targetType: 'PolicyholderContract', targetId: c.id, metadata: { companyId: id, line: input.line, by: 'super' } });
    return c;
  }

  async setContractActive(id: string, contractId: string, isActive: boolean) {
    const co = await this.company(id);
    const c = await this.db().policyholderContract.findFirst({ where: { id: contractId, companyId: id } });
    if (!c) throw new NotFoundException('بیمه‌نامه یافت نشد');
    await this.db().policyholderContract.update({ where: { id: contractId }, data: { isActive } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: co.tenantId, targetType: 'PolicyholderContract', targetId: contractId, metadata: { isActive, by: 'super' } });
    return { ok: true };
  }

  /**
   * Import the insurer's yearly policy export. Each sheet is one line («عمر…» → عمر, «حوادث…» → حوادث);
   * columns: شماره بیمه‌نامه، بیمه‌گذار («نام کد ۱۲۳۴»)، تاریخ شروع، تاریخ پایان. A company is matched
   * by its کد بیمه‌گزار (then by exact name), so one company gets one login across both sheets; each
   * (line, number, start date) becomes one policy year. Safe to re-run: existing rows are skipped.
   */
  async importExcel(buffer: Buffer, brokerTenantId: string, insurerTenantId: string): Promise<ImportResult> {
    const broker = await this.db().tenant.findUnique({ where: { id: brokerTenantId }, select: { kind: true } });
    if (broker?.kind !== 'BROKER') throw new BadRequestException('کارگزاری نامعتبر است');
    await this.assertInsurer(insurerTenantId);
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer as any); } catch { throw new BadRequestException('فایل اکسل خوانده نشد؛ قالب XLSX لازم است'); }

    const out: ImportResult = { sheets: [], companiesCreated: 0, companiesUpdated: 0, contractsCreated: 0, contractsUpdated: 0, contractsSkipped: 0, errors: [], credentials: [] };
    type Row = { sheet: string; row: number; line: InsuranceLine; policyNumber: string; name: string; code: string; start: Date | null; end: Date | null };
    const rows: Row[] = [];

    wb.eachSheet((ws) => {
      const title = fa(ws.name);
      const line: InsuranceLine | null = title.includes('عمر') ? 'LIFE' : title.includes('حوادث') ? 'ACCIDENT' : null;
      if (!line) { out.errors.push({ sheet: ws.name, row: 0, message: 'نام برگه باید «عمر» یا «حوادث» داشته باشد؛ این برگه وارد نشد' }); return; }
      // Header row: the first row that names the policy-number column.
      let header = 0; const col: Record<string, number> = {};
      for (let r = 1; r <= Math.min(10, ws.rowCount) && !header; r++) {
        ws.getRow(r).eachCell((cell, c) => {
          const h = fa(this.text(cell.value)).replace(/\s/g, '');
          if (h.includes('شمارهبیمهنامه')) { col.number = c; header = r; }
          else if (h.includes('بیمهگذار') || h.includes('بیمهگزار')) col.holder = c;
          else if (h.includes('تاریخشروع')) col.start = c;
          else if (h.includes('تاریخپایان')) col.end = c;
        });
      }
      if (!header || !col.holder) { out.errors.push({ sheet: ws.name, row: 0, message: 'ستون‌های «شماره بیمه نامه» و «بیمه گذار» پیدا نشد' }); return; }
      let count = 0;
      for (let r = header + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const num = toAsciiDigits(this.text(row.getCell(col.number).value)).trim();
        const holder = fa(this.text(row.getCell(col.holder).value));
        if (!num && !holder) continue;
        const m = holder.match(NAME_CODE);
        if (!num || !m) { out.errors.push({ sheet: ws.name, row: r, message: !num ? 'شماره بیمه‌نامه خالی است' : `کد بیمه‌گزار در «${holder}» پیدا نشد` }); continue; }
        const start = col.start ? this.date(row.getCell(col.start).value) : null;
        const end = col.end ? this.date(row.getCell(col.end).value) : null;
        rows.push({ sheet: ws.name, row: r, line, policyNumber: num, name: m[1].trim(), code: toAsciiDigits(m[2]), start, end });
        count++;
      }
      out.sheets.push({ name: ws.name, line, rows: count });
    });
    if (!rows.length) throw new BadRequestException(out.errors[0]?.message ?? 'هیچ ردیفی برای ورود پیدا نشد');

    await this.ensurePartnership(brokerTenantId, insurerTenantId);
    const db = this.db();
    const byCode = new Map<string, { id: string; name: string; hasPassword: boolean }>();
    for (const r of rows) {
      let co = byCode.get(r.code);
      if (!co) {
        const found = (await db.policyholderCompany.findFirst({ where: { tenantId: brokerTenantId, code: r.code } }))
          ?? (await db.policyholderCompany.findFirst({ where: { tenantId: brokerTenantId, code: null, name: r.name } }));
        if (found) {
          if (found.code !== r.code || found.name !== r.name) {
            await db.policyholderCompany.update({ where: { id: found.id }, data: { code: r.code, name: r.name } });
            out.companiesUpdated++;
          }
          co = { id: found.id, name: r.name, hasPassword: !!found.passwordHash };
        } else {
          const created = await db.policyholderCompany.create({ data: { tenantId: brokerTenantId, name: r.name, code: r.code }, select: { id: true } });
          out.companiesCreated++;
          co = { id: created.id, name: r.name, hasPassword: false };
        }
        if (!co.hasPassword) {
          const password = this.newPassword();
          await db.policyholderCompany.update({ where: { id: co.id }, data: { passwordHash: await this.hash.hashPassword(password), passwordSetAt: new Date() } });
          out.credentials.push({ code: r.code, name: r.name, password });
          co.hasPassword = true;
        }
        byCode.set(r.code, co);
      }
      const existing = await db.policyholderContract.findFirst({ where: { companyId: co.id, line: r.line, policyNumber: r.policyNumber, startDate: r.start } });
      if (existing) {
        if ((existing.endDate?.getTime() ?? null) !== (r.end?.getTime() ?? null) || existing.insurerTenantId !== insurerTenantId || !existing.isActive) {
          await db.policyholderContract.update({ where: { id: existing.id }, data: { endDate: r.end, insurerTenantId, isActive: true } });
          out.contractsUpdated++;
        } else out.contractsSkipped++;
        continue;
      }
      await db.policyholderContract.create({ data: { companyId: co.id, insurerTenantId, line: r.line, policyNumber: r.policyNumber, startDate: r.start, endDate: r.end } });
      out.contractsCreated++;
    }
    await this.audit.record({
      action: AuditAction.CREATE, tenantId: brokerTenantId, targetType: 'PolicyholderImport',
      metadata: { insurerTenantId, rows: rows.length, companiesCreated: out.companiesCreated, contractsCreated: out.contractsCreated, errors: out.errors.length },
    });
    return out;
  }

  // ── helpers ──
  private async company(id: string) {
    const co = await this.db().policyholderCompany.findUnique({ where: { id } });
    if (!co) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
    return co;
  }

  private async assertInsurer(id: string) {
    const t = await this.db().tenant.findUnique({ where: { id }, select: { kind: true } });
    if (t?.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');
  }

  /** The brokerage must be partnered with the insurer before its companies can route claims there. */
  private async ensurePartnership(brokerTenantId: string, insurerTenantId: string) {
    await this.db().brokerInsurerPartnership.upsert({
      where: { brokerTenantId_insurerTenantId: { brokerTenantId, insurerTenantId } },
      update: { isActive: true },
      create: { brokerTenantId, insurerTenantId, isActive: true },
    });
  }

  private newPassword() {
    let s = '';
    for (let i = 0; i < 10; i++) s += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
    return s;
  }

  private text(v: ExcelJS.CellValue): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      if ('richText' in v) return v.richText.map((t) => t.text).join('');
      if ('result' in v) return String(v.result ?? '');
      if ('text' in v) return String((v as any).text ?? '');
    }
    return String(v);
  }

  /** Jalali "1404/09/01" (Persian or Latin digits), or a real Excel date. */
  private date(v: ExcelJS.CellValue): Date | null {
    if (v instanceof Date) return v;
    const t = toAsciiDigits(this.text(v)).trim().replace(/-/g, '/');
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) return null;
    const d = fromJalali(t);
    return isNaN(d.getTime()) ? null : d;
  }
}
