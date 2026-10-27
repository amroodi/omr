import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, ClaimStatus, ClaimType, FieldSource, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toAsciiDigits, fromJalali } from '../../common/jalali/jalali.util';
import { nextClaimNumber } from '../claims/claim-number';

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
  فوت: 'causeOfDeathAlt', // a second «علت فوت» column in the register export
  'تاریخ پرداخت': 'paidDateCol', // in the export this often holds the birth date (years like 1329) — see importedFieldValues
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

/**
 * «تاریخ پرداخت» of the register export is often the deceased's birth date (the column is mislabelled
 * in the source system). A payment can't come before the death, so a date before «تاریخ فوت» — or,
 * with no death date, a year before 1380 — is a birth date; otherwise it's the payment date.
 */
function paidColIsBirth(d: Record<string, string>): boolean {
  const norm = (v?: string) => toAsciiDigits(String(v ?? '')).trim().replace(/-/g, '/').split('/').map((x, i) => (i ? x.padStart(2, '0') : x)).join('/');
  const paid = norm(d.paidDateCol);
  if (!/^\d{4}\//.test(paid)) return false;
  const death = norm(d.deathDate);
  if (/^\d{4}\//.test(death)) return paid < death;
  return Number(paid.slice(0, 4)) < 1380;
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
          const created = await this.createHistoricalClaim(db, r, { channel, insurerId, brokerTenantId });
          created ? claimsCreated++ : skipped++; // skipped = duplicate of an already-imported claim
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
  ): Promise<boolean> {
    const nid = toAsciiDigits(r.data.nationalCode);
    const nidHash = this.crypto.blindIndex(nid)!;
    const claimType = this.mapClaimType(r.data.causeOfDeath);
    const eventDate = this.parseDate(r.data.deathDate);

    // De-duplicate: the same deceased (blind index) + insurer + claim type + event date is the same
    // death event — skip re-imports (e.g. uploading the same file twice) instead of creating copies.
    const dup = await db.claim.findFirst({
      where: { insurerTenantId: parties.insurerId, deceasedNationalCodeHash: nidHash, claimType, eventDate },
      select: { id: true },
    });
    if (dup) return false;

    const amount = this.parseAmount(r.data.deathCapital) ?? this.parseAmount(r.data.payableAmount) ?? '0';
    const legacyData = Object.fromEntries(Object.entries(r.raw).filter(([k]) => !PII_HEADERS.has(k.trim())));
    // «سال/شماره بیمه‌نامه/n» — a historical case takes the year of the death (or today when unknown)
    const claimNumber = await nextClaimNumber(db as any, r.data.policyNumber || null, eventDate ?? new Date());

    const claim = await db.claim.create({
      data: {
        claimNumber,
        insurerTenantId: parties.insurerId,
        channel: parties.channel,
        brokerTenantId: parties.brokerTenantId,
        deceasedFullName: this.crypto.encrypt(r.data.fullName)!,
        deceasedNationalCode: this.crypto.encrypt(nid)!,
        deceasedNationalCodeHash: nidHash,
        claimType,
        eventDate,
        // «تاریخ تولد», or the export's mislabelled «تاریخ پرداخت» when it can only be a birth date
        deceasedBirthDate: this.parseDate(r.data.birthDate) ?? (paidColIsBirth(r.data) ? this.parseDate(r.data.paidDateCol) : null),
        policyNumber: r.data.policyNumber || null,
        claimedAmount: amount,
        status: r.claimStatus!,
        imported: true,
        legacyStatus: r.data.caseStatus || null,
        beneficiaryType: r.data.beneficiaryType || null,
        employerName: r.data.employerName || null,
        causeOfDeath: r.data.causeOfDeath || r.data.causeOfDeathAlt || null,
        legacyData: legacyData as Prisma.InputJsonValue,
        participants: {
          create: [
            { tenantId: parties.insurerId, role: 'INSURER' },
            ...(parties.brokerTenantId ? [{ tenantId: parties.brokerTenantId, role: 'MOAREF_BROKER' }] : []),
          ],
        },
      },
    });

    // Populate the structured claim-field values so «اطلاعات پرونده و بیمه‌نامه» is filled, each in
    // its own field, for imported claims (not just the canonical columns + legacyData blob).
    const fvs = this.importedFieldValues(r);
    if (fvs.length) {
      await db.claimFieldValue.createMany({
        data: fvs.map((f) => ({ claimId: claim.id, key: f.key, value: f.value, source: FieldSource.MANUAL, confirmedAt: new Date() })),
        skipDuplicates: true,
      });
    }
    return true;
  }

  /** Map a parsed import row to claim-field (key → value) pairs, skipping blanks. */
  private importedFieldValues(r: ParsedRow): { key: string; value: string }[] {
    const d = r.data;
    const raw = r.raw;
    const date = (v?: string | null) => (v ? toAsciiDigits(String(v)).trim() : '');
    const paidIsBirth = paidColIsBirth(d);
    // Workflow-stage columns aren't in HEADER_MAP; read them straight from the raw headers.
    const rawGet = (...headers: string[]): string | null => {
      for (const h of headers) if (raw[h] != null && String(raw[h]).trim()) return String(raw[h]).trim();
      return null;
    };
    const pairs: [string, string | null | undefined][] = [
      // ── claim / policy / beneficiary ──
      ['full_name', d.fullName],
      ['national_code', d.nationalCode],
      ['birth_date', date(d.birthDate) || (paidIsBirth ? date(d.paidDateCol) : '')],
      ['company_name', d.employerName],
      ['death_date', date(d.deathDate)],
      ['cause_of_death', d.causeOfDeath || d.causeOfDeathAlt],
      ['policy_number', d.policyNumber],
      ['policy_start_date', date(d.policyStart)],
      ['death_capital', this.parseAmount(d.deathCapital)],
      ['accident_capital', this.parseAmount(d.accidentCapital)],
      ['payable_amount', this.parseAmount(d.payableAmount)],
      ['beneficiary_type', d.beneficiaryType],
      // ── workflow stages (date/status pairs, read from the raw Excel headers) ──
      ['death_notice_date', date(rawGet('تاریخ اعلام فوت'))],
      ['death_notice_status', rawGet('وضعیت اعلام فوت')],
      ['broker_to_insurer_date', date(rawGet('تاریخ اعلام کارگزاری به بیمه‌گر', 'تاریخ اعلام کارگزاری به بیمه گر'))],
      ['broker_to_insurer_status', rawGet('وضعیت اعلام کارگزاری به بیمه‌گر', 'وضعیت اعلام کارگزاری به بیمه گر')],
      ['docs_receive_date', date(rawGet('تاریخ دریافت مدارک', 'تاریخ ارسال مدارک'))],
      ['docs_receive_status', rawGet('وضعیت دریافت مدارک', 'وضعیت ارسال مدارک')],
      ['docs_request_date', date(rawGet('تاریخ درخواست مدارک'))],
      ['docs_request_status', rawGet('وضعیت درخواست مدارک')],
      ['missing_docs_request_date', date(rawGet('تاریخ درخواست کسری مدارک'))],
      ['missing_docs_request_status', rawGet('وضعیت درخواست کسری مدارک')],
      ['send_to_hq_date', date(rawGet('تاریخ ارسال به ستاد'))],
      ['send_to_hq_status', rawGet('وضعیت ارسال به ستاد')],
      ['council_approve_date', date(rawGet('تاریخ تایید شورای فنی و سایر', 'تاریخ تایید شورای فنی'))],
      ['council_approve_status', rawGet('وضعیت تایید شورای فنی و سایر', 'وضعیت تایید شورای فنی')],
      ['return_to_branch_date', date(rawGet('تاریخ برگشت به شعبه'))],
      ['return_to_branch_status', rawGet('وضعیت برگشت به شعبه')],
      ['case_complete', rawGet('تکمیل پرونده')],
      ['case_complete_date', date(rawGet('تاریخ تکمیل پرونده'))],
      ['case_complete_status', rawGet('وضعیت تکمیل پرونده')],
      ['payment_order', rawGet('حواله پرداخت')],
      ['payment_order_date', date(rawGet('تاریخ حواله پرداخت')) || (!paidIsBirth ? date(d.paidDateCol) : '')],
      ['payment_order_status', rawGet('وضعیت حواله پرداخت')],
      // «وضعیت پرونده» of the register is the case's own status (shown as وضعیت پرونده everywhere)
      ['case_stage', d.caseStatus],
    ];
    return pairs
      .filter(([, v]) => v != null && String(v).trim().length > 0)
      .map(([key, v]) => ({ key, value: String(v).trim() }));
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

  /**
   * A row of the claim register (it has a «وضعیت پرونده» or a «تاریخ فوت») is a case: closed ones
   * (پرداخت شده / مختومه / رد) keep their final status, everything else comes in «در حال بررسی» and is
   * completed by hand from «ویرایش». A plain phone-book row (neither column) is an insured person.
   */
  private classify(data: Record<string, string>): { kind: RowKind; claimStatus?: ClaimStatus } {
    const status = (data.caseStatus || '').trim();
    if (status) {
      const match = FINAL_STATUS.find((f) => f.re.test(status));
      return { kind: 'CLAIM', claimStatus: match ? match.status : ClaimStatus.UNDER_REVIEW };
    }
    if ((data.deathDate || '').trim()) return { kind: 'CLAIM', claimStatus: ClaimStatus.UNDER_REVIEW };
    return { kind: 'PERSON' };
  }

  private validate(rec: { data: Record<string, string>; raw: Record<string, string> }, rowNum: number): ParsedRow {
    const { data, raw } = rec;
    const { kind, claimStatus } = this.classify(data);
    const errors: string[] = [];
    // Iranian National IDs are always 10 digits. Spreadsheets routinely store them as NUMBERS, which
    // silently drops leading zeros (0041051025 → 41051025) — and a custom display format like
    // «0000000000» only changes the look, not the stored value. So re-pad any short all-digit value
    // back to 10 here; these then import correctly with no per-cell hand-fixing. >10 digits or any
    // non-digit still fails. The padded value is written back so the writers persist the full code.
    let nid = data.nationalCode ? toAsciiDigits(data.nationalCode).replace(/\D/g, '') : '';
    if (nid.length > 0 && nid.length < 10) nid = nid.padStart(10, '0');
    data.nationalCode = nid;
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
      headerCells.forEach((header, i) => {
        const v = this.cellValue(row.getCell(i + 1)); // getCell is 1-based; i aligns with the header
        const cell = v === '0' ? '' : v; // the register export writes «0» for an empty cell
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

  /**
   * Best string for a cell. For NUMERIC cells we use ExcelJS's FORMATTED text (`cell.text`) instead
   * of the raw number, so a custom display format is honored — e.g. a National-ID column formatted
   * as `0000000000` keeps its leading zeros ("0012345678"), which the raw numeric value silently
   * drops. This reads exactly what Excel shows; it never invents zeros for an unformatted number.
   */
  private cellValue(cell: ExcelJS.Cell): string {
    const v = cell?.value;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const formatted = String(cell.text ?? '').trim();
      if (formatted) return formatted;
    }
    return this.cellText(v);
  }

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
