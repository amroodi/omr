import { Injectable } from '@nestjs/common';
import { AuditAction, CaseStatus, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { branchWhere } from '../../common/tenant/branch-scope';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';

const STATUS_FA: Record<CaseStatus, string> = {
  PAID: 'پرداخت شده',
  REVIEWING: 'در حال بررسی',
  UNPAYABLE: 'غیرقابل پرداخت',
  OTHER: 'سایر',
};

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  private canSeePii(): boolean {
    return (getContext()?.permissions ?? []).includes(PERMISSIONS.EXPORT_PII);
  }

  private async fetchRows(status?: CaseStatus) {
    const where: Prisma.CaseWhereInput = { ...branchWhere(), ...(status ? { status } : {}) };
    return this.prisma.scoped.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 10000,
      include: {
        insured: { select: { fullName: true, nationalCode: true, dateOfDeath: true } },
        beneficiary: { select: { type: true } },
        payments: { where: { status: 'PAID' }, orderBy: { date: 'desc' }, take: 1 },
      },
    });
  }

  private async tenantHeader() {
    const t = await this.prisma
      .unscoped()
      .tenant.findUnique({ where: { id: getTenantIdOrThrow() }, select: { name: true, contactHeader: true } });
    return { name: t?.name ?? '', contactHeader: t?.contactHeader ?? '' };
  }

  private nid(enc: string | null): string {
    if (!enc) return '';
    const v = this.crypto.decrypt(enc) ?? '';
    return this.canSeePii() ? v : v ? `••••••${v.slice(-4)}` : '';
  }

  /** Stream a branded XLSX of the (optionally filtered) case list to the response. */
  async casesXlsx(res: Response, status?: CaseStatus): Promise<void> {
    const [rows, header] = await Promise.all([this.fetchRows(status), this.tenantHeader()]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMR Damuon';
    const ws = wb.addWorksheet('پرونده‌ها', { views: [{ rightToLeft: true }] });

    // Branded header rows (tenant name + contact), injected per active tenant.
    ws.mergeCells('A1', 'I1');
    ws.getCell('A1').value = header.name;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    if (header.contactHeader) {
      ws.mergeCells('A2', 'I2');
      ws.getCell('A2').value = header.contactHeader;
      ws.getCell('A2').alignment = { horizontal: 'center' };
    }

    const headerRow = ws.addRow([
      'ردیف',
      'شماره پرونده',
      'کد ملی',
      'نام بیمه‌گذار',
      'نوع ذینفع',
      'تاریخ فوت',
      'وضعیت پرونده',
      'مبلغ پرداختی',
      'تاریخ پرداخت',
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    });

    rows.forEach((c, i) => {
      const paid = c.payments[0];
      ws.addRow([
        i + 1,
        c.caseNumber,
        this.nid(c.insured?.nationalCode ?? null),
        c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) : '',
        c.beneficiary?.type ?? '',
        c.insured?.dateOfDeath ? toJalali(c.insured.dateOfDeath, false) : '',
        STATUS_FA[c.status],
        paid ? paid.amount.toString() : '',
        paid ? toJalali(paid.date, false) : '',
      ]);
    });

    ws.columns.forEach((col) => {
      col.width = 18;
    });

    await this.audit.record({
      action: AuditAction.EXPORT,
      targetType: 'CaseList',
      metadata: { format: 'xlsx', count: rows.length, pii: this.canSeePii() },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cases.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  /** Branded, RTL, print-ready HTML for the case list (browser prints to PDF). */
  async casesPrintHtml(status?: CaseStatus): Promise<string> {
    const [rows, header] = await Promise.all([this.fetchRows(status), this.tenantHeader()]);
    await this.audit.record({ action: AuditAction.EXPORT, targetType: 'CaseList', metadata: { format: 'pdf-html', count: rows.length } });

    const body = rows
      .map((c, i) => {
        const paid = c.payments[0];
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(c.caseNumber)}</td>
          <td>${esc(this.nid(c.insured?.nationalCode ?? null))}</td>
          <td>${esc(c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) ?? '' : '')}</td>
          <td>${esc(STATUS_FA[c.status])}</td>
          <td>${paid ? esc(paid.amount.toString()) : ''}</td>
          <td>${paid ? esc(toJalali(paid.date, false)) : ''}</td>
        </tr>`;
      })
      .join('');

    return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>گزارش پرونده‌ها</title>
<style>
  body{font-family:Tahoma,sans-serif;padding:24px;color:#0f172a}
  h1{text-align:center;margin:0}
  .sub{text-align:center;color:#64748b;margin:4px 0 16px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}
  th{background:#eff6ff}
  @media print{@page{size:A4 landscape;margin:12mm}}
</style></head><body onload="window.print()">
  <h1>${esc(header.name)}</h1>
  <div class="sub">${esc(header.contactHeader)}</div>
  <table><thead><tr>
    <th>ردیف</th><th>شماره پرونده</th><th>کد ملی</th><th>نام بیمه‌گذار</th>
    <th>وضعیت پرونده</th><th>مبلغ پرداختی</th><th>تاریخ پرداخت</th>
  </tr></thead><tbody>${body}</tbody></table>
</body></html>`;
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
