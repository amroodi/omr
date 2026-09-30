import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toAsciiDigits } from '../../common/jalali/jalali.util';

// Accepts either English or Persian headers, mapped to canonical keys.
const HEADER_MAP: Record<string, string> = {
  national_code: 'nationalCode',
  'کد ملی': 'nationalCode',
  کدملی: 'nationalCode',
  full_name: 'fullName',
  name: 'fullName',
  نام: 'fullName',
  'نام بیمه‌گذار': 'fullName',
  phone: 'phone',
  mobile: 'phone',
  موبایل: 'phone',
  'شماره موبایل': 'phone',
  policy_number: 'policyNumber',
  'شماره بیمه‌نامه': 'policyNumber',
  carrier: 'carrier',
  'شرکت بیمه': 'carrier',
};

export interface ParsedRow {
  row: number;
  data: Record<string, string>;
  errors: string[];
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Parse + validate without writing. Returns a per-row preview with errors. */
  async preview(file: Express.Multer.File): Promise<{
    summary: { total: number; valid: number; invalid: number };
    rows: ParsedRow[];
  }> {
    const rows = await this.parse(file);
    const valid = rows.filter((r) => r.errors.length === 0).length;
    return { summary: { total: rows.length, valid, invalid: rows.length - valid }, rows };
  }

  /** Parse + validate, then create insured parties (and policies) for valid rows only. */
  async commit(file: Express.Multer.File): Promise<{ created: number; skipped: number }> {
    const tenantId = getTenantIdOrThrow();
    const rows = await this.parse(file);
    let created = 0;
    let skipped = 0;

    for (const r of rows) {
      if (r.errors.length > 0) {
        skipped++;
        continue;
      }
      const nid = toAsciiDigits(r.data.nationalCode);
      const phone = r.data.phone ? toAsciiDigits(r.data.phone) : null;
      const nidHash = this.crypto.blindIndex(nid)!;

      const existing = await this.prisma.scoped.insuredParty.findFirst({
        where: { nationalCodeHash: nidHash },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const insured = await this.prisma.scoped.insuredParty.create({
        data: {
          tenantId,
          nationalCode: this.crypto.encrypt(nid)!,
          nationalCodeHash: nidHash,
          fullName: this.crypto.encrypt(r.data.fullName)!,
          phone: phone ? this.crypto.encrypt(phone) : null,
          phoneHash: phone ? this.crypto.blindIndex(phone) : null,
        },
      });

      if (r.data.policyNumber) {
        await this.prisma.scoped.policy.create({
          data: {
            tenantId,
            insuredId: insured.id,
            policyNumber: r.data.policyNumber,
            carrier: r.data.carrier || 'نامشخص',
          },
        });
      }
      created++;
    }

    await this.audit.record({
      action: AuditAction.CREATE,
      targetType: 'BatchImport',
      metadata: { created, skipped },
    });
    return { created, skipped };
  }

  private async parse(file: Express.Multer.File): Promise<ParsedRow[]> {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    const isCsv = /\.csv$/i.test(file.originalname) || file.mimetype.includes('csv');
    const records = isCsv ? this.parseCsv(file.buffer.toString('utf8')) : await this.parseXlsx(file.buffer);
    return records.map((rec, idx) => this.validate(rec, idx + 2)); // +2: header row + 1-index
  }

  private validate(rec: Record<string, string>, rowNum: number): ParsedRow {
    const errors: string[] = [];
    const nid = rec.nationalCode ? toAsciiDigits(rec.nationalCode).trim() : '';
    if (!/^\d{10}$/.test(nid)) errors.push('کد ملی باید ۱۰ رقم باشد');
    if (!rec.fullName || rec.fullName.trim().length < 2) errors.push('نام الزامی است');
    if (rec.phone && !/^0?9\d{9}$/.test(toAsciiDigits(rec.phone))) errors.push('شماره موبایل نامعتبر است');
    return { row: rowNum, data: rec, errors };
  }

  private mapHeaders(headers: string[]): (string | null)[] {
    return headers.map((h) => HEADER_MAP[String(h ?? '').trim()] ?? null);
  }

  private async parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headerCells = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const keys = this.mapHeaders(headerCells);
    const out: Record<string, string>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: Record<string, string> = {};
      (row.values as unknown[]).slice(1).forEach((v, i) => {
        const key = keys[i];
        if (key) rec[key] = String(v ?? '').trim();
      });
      if (Object.keys(rec).length) out.push(rec);
    });
    return out;
  }

  private parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return [];
    const split = (l: string) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const keys = this.mapHeaders(split(lines[0]));
    return lines.slice(1).map((line) => {
      const cells = split(line);
      const rec: Record<string, string> = {};
      cells.forEach((v, i) => {
        const key = keys[i];
        if (key) rec[key] = v;
      });
      return rec;
    });
  }
}
