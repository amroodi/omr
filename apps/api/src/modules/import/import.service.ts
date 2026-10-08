import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, ClaimStatus, ClaimType, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toAsciiDigits, fromJalali } from '../../common/jalali/jalali.util';

// Accepts either English or Persian headers, mapped to canonical keys. Covers both the slim
// phone-book layout and the full legacy claim-register export. Persian names tolerate the
// ZWNJ-vs-space variants ("بیمه‌نامه" / "بیمه نامه").
const HEADER_MAP: Record<string, string> = {
  national_code: 'nationalCode',
  'کد ملی': 'nationalCode',
  کدملی: 'nationalCode',
  full_name: 'fullName',
  name: 'fullName',
  نام: 'fullName',
  'نام بیمه‌گذار': 'fullName',
  'نام بیمه گذار': 'fullName',
  'نام و نام خانوادگی': 'fullName',
  phone: 'phone',
  mobile: 'phone',
  موبایل: 'phone',
  'شماره موبایل': 'phone',
  policy_number: 'policyNumber',
  'شماره بیمه‌نامه': 'policyNumber',
  'شماره بیمه نامه': 'policyNumber',
  carrier: 'carrier',
  'شرکت بیمه': 'carrier',
  // ── claim-register columns ──
  'نام شرکت محل فعالیت': 'employerName',
  'سرمایه فوت': 'deathCapital',
  'سرمایه حادثه': 'accidentCapital',
  'مبلغ قابل پرداخت': 'payableAmount',
  'تاریخ فوت': 'deathDate',
  'علت فوت': 'causeOfDeath',
  'نوع ذینفع': 'beneficiaryType',
  'وضعیت پرونده': 'caseStatus',
  'تاریخ تولد': 'birthDate',
  'تاریخ شروع بیمه نامه': 'policyStart',
  'تاریخ شروع بیمه‌نامه': 'policyStart',
};

// Raw source headers that hold PII — excluded from the stored legacyData blob (they are already
// persisted encrypted as first-class claim fields).
const PII_HEADERS = new Set(['کد ملی', 'کدملی', 'نام و نام خانوادگی', 'نام', 'نام بیمه‌گذار', 'نام بیمه گذار']);

// A row counts as a settled historical claim only when its وضعیت پرونده matches a terminal state.
// Anything else (in-progress, or a plain phone-book file) is imported as an insured person.
const FINAL_STATUS: { re: RegExp; status: ClaimStatus }[] = [
  { re: /پرداخت/, status: ClaimStatus.PAID }, // پرداخت شده
  { re: /مختومه|بسته\s*شد/, status: ClaimStatus.PAID },
  { re: /عدم\s*(تایید|تأیید|موافقت)|رد\s*شد|^رد$/, status: ClaimStatus.REJECTED },
  { re: /تایید\s*نهایی|تأیید\s*نهایی/, status: ClaimStatus.APPROVED },
];

export type RowKind = 'CLAIM' | 'PERSON';

export interface ParsedRow {
  row: number;
  kind: RowKind;
  claimStatus?: ClaimStatus; // set when kind === 'CLAIM'
  data: Record<string, string>;
  raw: Record<string, string>; // original-header → value (used to build legacyData)
  errors: string[];
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Parse + validate without writing. Returns a per-row preview with its detected kind. */
  async preview(file: Express.Multer.File): Promise<{
    summary: { total: number; claims: number; people: number; invalid: number };
    rows: ParsedRow[];
  }> {
    const rows = await this.parse(file);
    return { summary: this.summarize(rows), rows };
  }

  /**
   * Parse + validate, then for valid rows create either a settled historical claim (final rows)
   * or an insured party + policy (everything else). `insurerTenantId` is required when the caller
   * is a brokerage (every claim row is filed against that insurer); an insurer imports its own book.
   */
  async commit(
    file: Express.Multer.File,
    insurerTenantId?: string,
  ): Promise<{ claimsCreated: number; peopleCreated: number; skipped: number }> {
    const tenantId = getTenantIdOrThrow();
    const db = this.prisma.unscoped();

    const self = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    if (!self) throw new BadRequestException('سازمان نامعتبر است');

    // Resolve the claim parties up front (same for every claim row in the file).
    let channel: 'BROKER' | 'DIRECT';
    let insurerId: string;
    let brokerTenantId: string | null = null;
    if (self.kind === 'BROKER') {
      if (!insurerTenantId) throw new BadRequestException('بیمه‌گر را انتخاب کنید');
      const insurer = await db.tenant.findUnique({ where: { id: insurerTenantId }, select: { kind: true } });
      if (!insurer || insurer.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');
      channel = 'BROKER';
      insurerId = insurerTenantId;
      brokerTenantId = tenantId;
    } else {
      channel = 'DIRECT';
      insurerId = tenantId;
    }

    const rows = await this.parse(file);
    let claimsCreated = 0;
    let peopleCreated = 0;
    let skipped = 0;

    for (const r of rows) {
      if (r.errors.length > 0) {
        skipped++;
        continue;
      }
      try {
        if (r.kind === 'CLAIM') {
          await this.createHistoricalClaim(db, r, { channel, insurerId, brokerTenantId });
          claimsCreated++;
        } else {
          const did = await this.createInsured(r);
          did ? peopleCreated++ : skipped++;
        }
      } catch {
        skipped++;
      }
    }

    await this.audit.record({
      action: AuditAction.CREATE,
      targetType: 'BatchImport',
      metadata: { claimsCreated, peopleCreated, skipped, insurerTenantId: insurerId },
    });
    return { claimsCreated, peopleCreated, skipped };
  }

  // ─────────────────────────── writers ───────────────────────────

  /** Insured-party (+ optional policy) phone-book row. Returns false if the person already exists. */
  private async createInsured(r: ParsedRow): Promise<boolean> {
    const tenantId = getTenantIdOrThrow();
    const nid = toAsciiDigits(r.data.nationalCode);
    const phone = r.data.phone ? toAsciiDigits(r.data.phone) : null;
    const nidHash = this.crypto.blindIndex(nid)!;

    const existing = await this.prisma.scoped.insuredParty.findFirst({ where: { nationalCodeHash: nidHash }, select: { id: true } });
    if (existing) return false;

    const insured = await this.prisma.scoped.insuredParty.create({
      data: {
        tenantId,
        nationalCode: this.crypto.encrypt(nid)!,
        nationalCodeHash: nidHash,
        fullName: this.crypto.encrypt(r.data.fullName)!,
        phone: phone ? this.crypto.encrypt(phone) : null,
        phoneHash: phone ? this.crypto.blindIndex(phone) : null,
        birthDate: this.parseDate(r.data.birthDate),
      },
    });
    if (r.data.policyNumber) {
      await this.prisma.scoped.policy.create({
        data: { tenantId, insuredId: insured.id, policyNumber: r.data.policyNumber, carrier: r.data.carrier || 'نامشخص' },
      });
    }
    return true;
  }

  /** Settled claim migrated from the legacy system — archived, no workflow steps. */
  private async createHistoricalClaim(
    db: Prisma.TransactionClient | ReturnType<PrismaService['unscoped']>,
    r: ParsedRow,
    parties: { channel: 'BROKER' | 'DIRECT'; insurerId: string; brokerTenantId: string | null },
  ) {
    const nid = toAsciiDigits(r.data.nationalCode);
    const amount = this.parseAmount(r.data.deathCapital) ?? this.parseAmount(r.data.payableAmount) ?? '0';
    const legacyData = Object.fromEntries(Object.entries(r.raw).filter(([k]) => !PII_HEADERS.has(k.trim())));
    const claimNumber = await this.nextClaimNumber(db);

    await db.claim.create({
      data: {
        claimNumber,
        insurerTenantId: parties.insurerId,
        channel: parties.channel,
        brokerTenantId: parties.brokerTenantId,
        deceasedFullName: this.crypto.encrypt(r.data.fullName)!,
        deceasedNationalCode: this.crypto.encrypt(nid)!,
        deceasedNationalCodeHash: this.crypto.blindIndex(nid)!,
        claimType: this.mapClaimType(r.data.causeOfDeath),
        eventDate: this.parseDate(r.data.deathDate),
        policyNumber: r.data.policyNumber || null,
        claimedAmount: amount,
        status: r.claimStatus!,
        imported: true,
        legacyStatus: r.data.caseStatus || null,
        beneficiaryType: r.data.beneficiaryType || null,
        employerName: r.data.employerName || null,
        causeOfDeath: r.data.causeOfDeath || null,
        legacyData: legacyData as Prisma.InputJsonValue,
        participants: {
          create: [
            { tenantId: parties.insurerId, role: 'INSURER' },
            ...(parties.brokerTenantId ? [{ tenantId: parties.brokerTenantId, role: 'MOAREF_BROKER' }] : []),
          ],
        },
      },
    });
  }

  private async nextClaimNumber(db: { claim: { count: () => Promise<number>; findUnique: (a: any) => Promise<any> } }): Promise<string> {
    let seq = (await db.claim.count()) + 1;
    for (;;) {
      const num = `CLM-${String(seq).padStart(5, '0')}`;
      const exists = await db.claim.findUnique({ where: { claimNumber: num }, select: { id: true } });
      if (!exists) return num;
      seq++;
    }
  }

  // ─────────────────────────── parsing / classification ───────────────────────────

  private summarize(rows: ParsedRow[]) {
    const valid = rows.filter((r) => r.errors.length === 0);
    return {
      total: rows.length,
      claims: valid.filter((r) => r.kind === 'CLAIM').length,
      people: valid.filter((r) => r.kind === 'PERSON').length,
      invalid: rows.length - valid.length,
    };
  }

  private async parse(file: Express.Multer.File): Promise<ParsedRow[]> {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    const isCsv = /\.csv$/i.test(file.originalname) || file.mimetype.includes('csv');
    const records = isCsv ? this.parseCsv(file.buffer.toString('utf8')) : await this.parseXlsx(file.buffer);
    return records.map((rec, idx) => this.validate(rec, idx + 2)); // +2: header row + 1-index
  }

  private classify(data: Record<string, string>): { kind: RowKind; claimStatus?: ClaimStatus } {
    const status = (data.caseStatus || '').trim();
    if (status) {
      const match = FINAL_STATUS.find((f) => f.re.test(status));
      if (match) return { kind: 'CLAIM', claimStatus: match.status };
    }
    return { kind: 'PERSON' };
  }

  private validate(rec: { data: Record<string, string>; raw: Record<string, string> }, rowNum: number): ParsedRow {
    const { data, raw } = rec;
    const { kind, claimStatus } = this.classify(data);
    const errors: string[] = [];
    const nid = data.nationalCode ? toAsciiDigits(data.nationalCode).trim() : '';
    if (!/^\d{10}$/.test(nid)) errors.push('کد ملی باید ۱۰ رقم باشد');
    if (!data.fullName || data.fullName.trim().length < 2) errors.push('نام الزامی است');
    if (kind === 'PERSON' && data.phone && !/^0?9\d{9}$/.test(toAsciiDigits(data.phone))) errors.push('شماره موبایل نامعتبر است');
    return { row: rowNum, kind, claimStatus, data, raw, errors };
  }

  private mapHeaders(headers: string[]): (string | null)[] {
    return headers.map((h) => HEADER_MAP[String(h ?? '').trim()] ?? null);
  }

  private async parseXlsx(buffer: Buffer): Promise<{ data: Record<string, string>; raw: Record<string, string> }[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headerCells = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const keys = this.mapHeaders(headerCells);
    const out: { data: Record<string, string>; raw: Record<string, string> }[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const data: Record<string, string> = {};
      const raw: Record<string, string> = {};
      (row.values as unknown[]).slice(1).forEach((v, i) => {
        const cell = this.cellText(v);
        const header = headerCells[i];
        if (header) raw[header.trim()] = cell;
        const key = keys[i];
        if (key) data[key] = cell;
      });
      if (Object.values(data).some((v) => v.length)) out.push({ data, raw });
    });
    return out;
  }

  private parseCsv(text: string): { data: Record<string, string>; raw: Record<string, string> }[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return [];
    const split = (l: string) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const headerCells = split(lines[0]);
    const keys = this.mapHeaders(headerCells);
    return lines.slice(1).map((line) => {
      const cells = split(line);
      const data: Record<string, string> = {};
      const raw: Record<string, string> = {};
      cells.forEach((v, i) => {
        const header = headerCells[i];
        if (header) raw[header.trim()] = v;
        const key = keys[i];
        if (key) data[key] = v;
      });
      return { data, raw };
    });
  }

  // ─────────────────────────── cell helpers ───────────────────────────

  /** ExcelJS cells may be rich-text / hyperlink / formula objects; normalize to a trimmed string. */
  private cellText(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('text' in o) return String(o.text ?? '').trim();
      if ('result' in o) return String(o.result ?? '').trim();
      if ('richText' in o && Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('').trim();
    }
    return String(v).trim();
  }

  private parseAmount(v?: string): string | null {
    if (!v) return null;
    const digits = toAsciiDigits(v).replace(/[^\d]/g, '');
    return digits.length ? digits : null;
  }

  private parseDate(v?: string): Date | null {
    if (!v) return null;
    const s = toAsciiDigits(v).trim();
    if (!/^\d{3,4}\/\d{1,2}\/\d{1,2}$/.test(s)) return null;
    try {
      const d = fromJalali(s);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  private mapClaimType(cause?: string): ClaimType {
    const c = cause || '';
    if (/نقص\s*عضو|ازکارافتادگی|از\s*کار\s*افتادگی/.test(c)) return ClaimType.DISABILITY_ACCIDENT;
    if (/حادثه/.test(c)) return ClaimType.DEATH_ACCIDENT;
    return ClaimType.DEATH_ILLNESS;
  }
}
