import { Injectable, NotFoundException } from '@nestjs/common';
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
import { NotificationsService } from '../notifications/notifications.service';

const STATUS_FA: Record<CaseStatus, string> = {
  PAID: 'پرداخت شده',
  REVIEWING: 'در حال بررسی',
  UNPAYABLE: 'غیرقابل پرداخت',
  OTHER: 'سایر',
};

const CLAIM_STATUS_FA: Record<string, string> = {
  DRAFT: 'پیش‌نویس', SUBMITTED: 'ثبت‌شده', UNDER_REVIEW: 'در حال بررسی', RETURNED_INCOMPLETE: 'نقص مدارک',
  APPROVED: 'تاییدشده', REJECTED: 'ردشده', PAID: 'پرداخت‌شده',
};
const CLAIM_TYPE_FA: Record<string, string> = {
  DEATH_ILLNESS: 'فوت ناشی از بیماری', DEATH_ACCIDENT: 'فوت ناشی از حادثه', DISABILITY_ACCIDENT: 'نقص عضو / ازکارافتادگی ناشی از حادثه',
};

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private canSeePii(): boolean {
    return (getContext()?.permissions ?? []).includes(PERMISSIONS.EXPORT_PII);
  }

  /** Human label for the current actor, for export-activity messages. */
  private async actorLabel(): Promise<string> {
    const ctx = getContext();
    if (ctx?.actorType === 'SUPER_ADMIN') return 'مدیر سامانه';
    if (ctx?.actorId) {
      const u = await this.prisma.unscoped().orgUser.findUnique({ where: { id: ctx.actorId }, select: { displayName: true, username: true } });
      return u?.displayName || u?.username || 'کاربر سازمان';
    }
    return 'سیستم';
  }

  /** Oversight note to the acting operator's own-org admins after an export (in-panel only). */
  private async notifyAdminsExport(what: string, count: number, pii: boolean) {
    const ctx = getContext();
    const piiNote = pii ? ' (با کد ملی کامل)' : '';
    await this.notifications.notifyOrgAdmins(
      ctx?.tenantId,
      'خروجی گرفته شد',
      `${await this.actorLabel()} ${what} (${count.toLocaleString('fa-IR')} ردیف) را خروجی گرفت${piiNote}.`,
      '/org/claims',
      { excludeActorId: ctx?.actorId ?? null },
    );
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
    await this.notifyAdminsExport('فهرست پرونده‌ها (اکسل)', rows.length, this.canSeePii());

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cases.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  /** Branded, RTL, print-ready HTML for the case list (browser prints to PDF). */
  async casesPrintHtml(status?: CaseStatus): Promise<string> {
    const [rows, header] = await Promise.all([this.fetchRows(status), this.tenantHeader()]);
    await this.audit.record({ action: AuditAction.EXPORT, targetType: 'CaseList', metadata: { format: 'pdf-html', count: rows.length } });
    await this.notifyAdminsExport('فهرست پرونده‌ها (PDF)', rows.length, this.canSeePii());

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

  // ─────────────────────────── Death-claim exports ───────────────────────────

  /** Claims the caller's tenant participates in (not soft-deleted). */
  private claimTenantWhere(): Prisma.ClaimWhereInput {
    const tenantId = getTenantIdOrThrow();
    return { deletedAt: null, OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }, { participants: { some: { tenantId } } }] };
  }

  private async fetchClaims(status?: string, q?: string) {
    const where: Prisma.ClaimWhereInput = { ...this.claimTenantWhere(), ...(status ? { status: status as any } : {}) };
    const claims = await this.prisma.partyReplica().claim.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 10000,
      select: { id: true, claimNumber: true, claimType: true, status: true, deceasedFullName: true, deceasedNationalCode: true, claimedAmount: true, eventDate: true, insurerTenantId: true },
    });
    if (!q) return claims;
    const ql = q.toLowerCase();
    return claims.filter((c) => {
      const name = c.deceasedFullName ? (this.crypto.decrypt(c.deceasedFullName) ?? '') : '';
      return `${c.claimNumber} ${name}`.toLowerCase().includes(ql);
    });
  }

  /** Bulk XLSX of the (optionally filtered) death-claim list. Audit-logged (tamper-evident chain). */
  async claimsXlsx(res: Response, status?: string, q?: string): Promise<void> {
    const [rows, header] = await Promise.all([this.fetchClaims(status, q), this.tenantHeader()]);
    const insurerIds = [...new Set(rows.map((r) => r.insurerTenantId))];
    const tenants = insurerIds.length ? await this.prisma.replica().tenant.findMany({ where: { id: { in: insurerIds } }, select: { id: true, name: true } }) : [];
    const tMap = new Map(tenants.map((t) => [t.id, t.name]));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMR Damuon';
    const ws = wb.addWorksheet('پرونده‌های خسارت', { views: [{ rightToLeft: true }] });
    ws.mergeCells('A1', 'H1');
    ws.getCell('A1').value = header.name;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    const headerRow = ws.addRow(['ردیف', 'شماره پرونده', 'نوع', 'بیمه‌شده (متوفی)', 'کد ملی', 'بیمه‌گر', 'وضعیت', 'مبلغ خسارت']);
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; });
    rows.forEach((c, i) => {
      ws.addRow([
        i + 1,
        c.claimNumber,
        CLAIM_TYPE_FA[c.claimType] ?? c.claimType,
        c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : '',
        this.nid(c.deceasedNationalCode ?? null),
        tMap.get(c.insurerTenantId) ?? '',
        CLAIM_STATUS_FA[c.status] ?? c.status,
        c.claimedAmount != null ? c.claimedAmount.toString() : '',
      ]);
    });
    ws.columns.forEach((col) => { col.width = 20; });

    await this.audit.record({ action: AuditAction.EXPORT, targetType: 'ClaimList', metadata: { format: 'xlsx', count: rows.length, status: status ?? null, pii: this.canSeePii() } });
    await this.notifyAdminsExport('فهرست پرونده‌های خسارت (اکسل)', rows.length, this.canSeePii());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="claims.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  /**
   * A report built in the browser (columns, filters and grouping chosen by the user) saved as Excel:
   * organization name, report title and filters on top, then the table. Audit-logged with its size.
   */
  async tableXlsx(res: Response, t: { title: string; subtitle?: string; headers: string[]; rows: (string | number | null)[][] }): Promise<void> {
    const header = await this.tenantHeader();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMR Damuon';
    const ws = wb.addWorksheet('گزارش', { views: [{ rightToLeft: true }] });
    const width = Math.max(1, t.headers.length);
    const title = (text: string, size: number) => {
      const row = ws.addRow([text]);
      ws.mergeCells(row.number, 1, row.number, width);
      row.getCell(1).font = { bold: true, size };
      row.getCell(1).alignment = { horizontal: 'center', wrapText: true };
    };
    title(header.name, 14);
    title(t.title, 12);
    if (t.subtitle) title(t.subtitle, 10);
    title(`تاریخ تهیه: ${toJalali(new Date())}`, 9);
    ws.addRow([]);
    const hr = ws.addRow(t.headers);
    hr.font = { bold: true };
    hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } }; });
    for (const r of t.rows) ws.addRow((Array.isArray(r) ? r : []).slice(0, width).map((v) => (v == null ? '' : typeof v === 'number' ? v : String(v).slice(0, 2000))));
    ws.columns.forEach((col) => { col.width = 22; });
    await this.audit.record({ action: AuditAction.EXPORT, targetType: 'ClaimReport', metadata: { format: 'xlsx', title: t.title, rows: t.rows.length, columns: t.headers.length } });
    await this.notifyAdminsExport(`گزارش «${t.title}» (اکسل)`, t.rows.length, false);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  /** Single-claim XLSX: header facts + every structured field value. Audit-logged. */
  async claimXlsx(res: Response, claimId: string): Promise<void> {
    const claim = await this.prisma.partyReplica().claim.findFirst({ where: { id: claimId, ...this.claimTenantWhere() } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    const [defs, vals, insurer, header] = await Promise.all([
      this.prisma.replica().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, orderBy: { order: 'asc' } }),
      this.prisma.partyReplica().claimFieldValue.findMany({ where: { claimId } }),
      this.prisma.replica().tenant.findUnique({ where: { id: claim.insurerTenantId }, select: { name: true } }),
      this.tenantHeader(),
    ]);
    const vmap = new Map(vals.map((v) => [v.key, v.value ?? '']));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'OMR Damuon';
    const ws = wb.addWorksheet(`پرونده ${claim.claimNumber}`, { views: [{ rightToLeft: true }] });
    ws.mergeCells('A1', 'B1');
    ws.getCell('A1').value = `${header.name} — پرونده ${claim.claimNumber}`;
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    const pair = (k: string, v: string) => ws.addRow([k, v]);
    pair('نوع', CLAIM_TYPE_FA[claim.claimType] ?? claim.claimType);
    pair('وضعیت', CLAIM_STATUS_FA[claim.status] ?? claim.status);
    pair('بیمه‌گر', insurer?.name ?? '');
    pair('بیمه‌شده (متوفی)', claim.deceasedFullName ? (this.crypto.decrypt(claim.deceasedFullName) ?? '') : '');
    pair('کد ملی', this.nid(claim.deceasedNationalCode ?? null));
    pair('مبلغ خسارت', claim.claimedAmount != null ? claim.claimedAmount.toString() : '');
    pair('تاریخ وقوع', claim.eventDate ? toJalali(claim.eventDate, false) : '');
    const sep = ws.addRow(['— اطلاعات تفصیلی —', '']);
    sep.font = { bold: true };
    for (const d of defs) {
      const val = vmap.get(d.key);
      if (val && val.trim() !== '') pair(d.label, val);
    }
    ws.getColumn(1).width = 32;
    ws.getColumn(2).width = 48;
    ws.getColumn(1).font = { bold: true };

    await this.audit.record({ action: AuditAction.EXPORT, targetType: 'Claim', targetId: claimId, metadata: { format: 'xlsx', single: true, pii: this.canSeePii() } });
    await this.notifyAdminsExport(`پروندهٔ ${claim.claimNumber} (اکسل)`, 1, this.canSeePii());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="claim-${claim.claimNumber}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
