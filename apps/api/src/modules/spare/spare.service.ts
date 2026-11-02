import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { toAsciiDigits, toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { validateField } from '../../common/validation/field-validation';
import { DEFAULT_CLAIM_FIELDS } from '../claim-fields/defaults';
import { CLAIM_DOC_TYPES_FA, claimDocOk, EXCEL_MIME } from '../claims/claims.service';
import { DEFAULT_CASE_TYPES } from '../claims/workflow';
import { ImportService } from '../import/import.service';
import { ModelStore } from '../model-view/model-store.service';
import { DEFAULT_REQUIRED_DOCS } from '../required-docs/defaults';

const BENEFICIARY_FILE = 'BENEFICIARY_FILE';
const SOURCE_ROW = '_sourceRow'; // not a field: the imported Excel row as it was

/**
 * «میز کار مستقل»: a brokerage's own cases, kept outside the claim hierarchy. They live in their own
 * tables (SpareCase, SpareDocument), so no desk, insurer, report or inquiry of the hierarchy can reach
 * them. Super Admin switches the desk per brokerage; the `spare:work` permission picks the operators.
 * Case kinds, documents and fields follow the brokerage's insurer when it has one, else the defaults.
 */
@Injectable()
export class SpareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly store: ModelStore,
    private readonly importer: ImportService,
  ) {}

  private db() {
    return this.prisma.unscoped(); // every query below filters by the caller's own tenant
  }

  /** The caller's brokerage, when its desk is on. Off: the desk doesn't exist, its data stays. */
  private async tenantOn(): Promise<string> {
    const tenantId = getTenantIdOrThrow();
    const t = await this.db().tenant.findUnique({ where: { id: tenantId }, select: { kind: true, spareDeskEnabled: true } });
    if (t?.kind !== 'BROKER' || !t.spareDeskEnabled) throw new ForbiddenException('میز کار مستقل برای این سازمان فعال نیست');
    return tenantId;
  }

  private async insurerOf(tenantId: string): Promise<string | null> {
    const p = await this.db().brokerInsurerPartnership.findFirst({ where: { brokerTenantId: tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { insurerTenantId: true } });
    return p?.insurerTenantId ?? null;
  }

  private async caseTypes(tenantId: string) {
    const insurer = await this.insurerOf(tenantId);
    return insurer ? this.store.get(insurer).form.caseTypes : DEFAULT_CASE_TYPES;
  }

  private async fieldDefs(tenantId: string) {
    const insurer = await this.insurerOf(tenantId);
    const defs = insurer ? await this.db().claimFieldDef.findMany({ where: { tenantId: insurer, isActive: true }, orderBy: { order: 'asc' } }) : [];
    return defs.length
      ? defs.map((d) => ({ key: d.key, label: d.label, type: d.type, group: d.group as string, options: d.options, required: d.required }))
      : DEFAULT_CLAIM_FIELDS.map((d) => ({ key: d.key, label: d.label, type: d.type, group: d.group as string, options: d.options ?? [], required: !!d.required }));
  }

  private async docsFor(tenantId: string, claimType: string) {
    const insurer = await this.insurerOf(tenantId);
    const rows = insurer ? await this.db().requiredDocument.findMany({ where: { tenantId: insurer, isActive: true, appliesToTypes: { has: claimType } } }) : [];
    const list = rows.length ? rows : DEFAULT_REQUIRED_DOCS.filter((d) => d.appliesToTypes.includes(claimType));
    return [...list].sort((a, b) => a.order - b.order).map((d) => ({ code: d.code, label: d.label, required: d.requiredTypes.includes(claimType) }));
  }

  private valuesOf(c: { values: string }): Record<string, string> {
    try { return JSON.parse(this.crypto.decrypt(c.values) ?? '{}'); } catch { return {}; }
  }

  private sealed(values: Record<string, string>) {
    const nid = toAsciiDigits(values.national_code ?? '').trim();
    return { values: this.crypto.encrypt(JSON.stringify(values))!, nationalCodeHash: nid ? this.crypto.blindIndex(nid) : null };
  }

  private async own(tenantId: string, id: string) {
    const c = await this.db().spareCase.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!c) throw new NotFoundException('پرونده یافت نشد');
    return c;
  }

  private present(c: any, types: { code: string; label: string }[], companies: Map<string, string>) {
    const v = this.valuesOf(c);
    return {
      id: c.id, number: c.seq, claimType: c.claimType, claimTypeLabel: types.find((t) => t.code === c.claimType)?.label ?? c.claimType,
      fullName: v.full_name ?? null, nationalCode: v.national_code ?? null, companyName: v.company_name ?? null, policyNumber: v.policy_number ?? null,
      eventDate: v.death_date ?? null, payableAmount: v.payable_amount ?? null, caseStage: v.case_stage ?? null, notes: v.case_notes ?? null,
      imported: c.imported, createdAt: toJalali(c.createdAt, false),
      sharedCompanyId: c.sharedCompanyId, sharedCompanyName: c.sharedCompanyId ? companies.get(c.sharedCompanyId) ?? null : null,
    };
  }

  private async companyNames(tenantId: string) {
    const rows = await this.db().policyholderCompany.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return { rows, map: new Map(rows.map((r) => [r.id, r.name])) };
  }

  async options() {
    const tenantId = await this.tenantOn();
    const [caseTypes, companies] = await Promise.all([this.caseTypes(tenantId), this.companyNames(tenantId)]);
    return { caseTypes: caseTypes.map((t) => ({ code: t.code, label: t.label })), companies: companies.rows };
  }

  async list(q: { nationalCode?: string; name?: string; claimType?: string; companyId?: string }) {
    const tenantId = await this.tenantOn();
    const nid = toAsciiDigits(q.nationalCode ?? '').replace(/\D/g, '');
    const rows = await this.db().spareCase.findMany({
      where: {
        tenantId, deletedAt: null,
        ...(q.claimType ? { claimType: q.claimType } : {}),
        ...(q.companyId ? { sharedCompanyId: q.companyId } : {}),
        ...(nid ? { nationalCodeHash: this.crypto.blindIndex(nid) } : {}),
      },
      orderBy: { seq: 'desc' }, take: 20000,
    });
    const [types, companies] = await Promise.all([this.caseTypes(tenantId), this.companyNames(tenantId)]);
    const out = rows.map((c) => this.present(c, types, companies.map));
    const name = (q.name ?? '').trim();
    return name ? out.filter((r) => (r.fullName ?? '').includes(name)) : out;
  }

  async create(claimType: string) {
    const tenantId = await this.tenantOn();
    const types = await this.caseTypes(tenantId);
    if (!types.some((t) => t.code === claimType)) throw new BadRequestException('نوع پرونده نامعتبر است');
    const c = await this.db().spareCase.create({ data: { tenantId, claimType, ...this.sealed({}), createdById: getContext()?.actorId ?? null } });
    await this.audit.record({ action: AuditAction.CREATE, tenantId, targetType: 'SpareCase', targetId: c.id, metadata: { claimType } });
    const companies = await this.companyNames(tenantId);
    return this.present(c, types, companies.map);
  }

  async get(id: string) {
    const tenantId = await this.tenantOn();
    const [c, types, companies] = await Promise.all([this.own(tenantId, id), this.caseTypes(tenantId), this.companyNames(tenantId)]);
    return this.present(c, types, companies.map);
  }

  async remove(id: string) {
    const tenantId = await this.tenantOn();
    await this.own(tenantId, id);
    await this.db().spareCase.update({ where: { id }, data: { deletedAt: new Date(), sharedCompanyId: null, sharedAt: null } });
    await this.audit.record({ action: AuditAction.DELETE, tenantId, targetType: 'SpareCase', targetId: id });
    return { ok: true };
  }

  // ── Fields: same catalog and same response as «ویرایش» of a case, all editable ──

  async fields(id: string) {
    const tenantId = await this.tenantOn();
    const c = await this.own(tenantId, id);
    const v = this.valuesOf(c);
    const groups: Record<string, any[]> = { CLAIM_DATA: [], BENEFICIARY: [], WORKFLOW_STAGE: [] };
    for (const d of await this.fieldDefs(tenantId)) {
      (groups[d.group] ??= []).push({ key: d.key, label: d.label, type: d.type, options: d.options, required: d.required, value: v[d.key] ?? null, source: v[d.key] ? 'MANUAL' : null, confidence: null, confirmed: true, canEdit: true });
    }
    return { claimId: id, party: 'MOAREF', manual: false, groups, archived: false };
  }

  async setField(id: string, key: string, value: string) {
    const tenantId = await this.tenantOn();
    const c = await this.own(tenantId, id);
    const def = (await this.fieldDefs(tenantId)).find((d) => d.key === key);
    if (!def) throw new NotFoundException('فیلد تعریف نشده است');
    const check = validateField(def.type as any, value, { options: def.options });
    if (!check.valid) throw new BadRequestException(check.message);
    const v = this.valuesOf(c);
    if (value?.trim()) v[key] = value.trim(); else delete v[key];
    await this.db().spareCase.update({ where: { id }, data: this.sealed(v) });
    await this.audit.record({ action: AuditAction.EDIT, tenantId, targetType: 'SpareCase', targetId: id, metadata: { key } });
    return { key, value: v[key] ?? null, source: 'MANUAL', confirmed: true };
  }

  // ── Documents ──

  private presentDoc(d: any) {
    return { id: d.id, docCode: d.docCode, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: toJalali(d.createdAt, false) };
  }

  async documents(id: string) {
    const tenantId = await this.tenantOn();
    await this.own(tenantId, id);
    const rows = await this.db().spareDocument.findMany({ where: { caseId: id, tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((d) => this.presentDoc(d));
  }

  /** The نوع پرونده's document list; nothing blocks here, «الزامی» only marks what a full file has. */
  async checklist(id: string) {
    const tenantId = await this.tenantOn();
    const c = await this.own(tenantId, id);
    return this.checklistOf(tenantId, c.id, c.claimType);
  }

  private async checklistOf(tenantId: string, caseId: string, claimType: string) {
    const [docs, files] = await Promise.all([
      this.docsFor(tenantId, claimType),
      this.db().spareDocument.findMany({ where: { caseId, tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      items: docs.map((d) => ({ ...d, documents: files.filter((f) => f.docCode === d.code).map((f) => this.presentDoc(f)) })),
      otherDocuments: files.filter((f) => !docs.some((d) => d.code === f.docCode)).map((f) => this.presentDoc(f)),
    };
  }

  async upload(id: string, file: Express.Multer.File, docCode: string) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    const code = (docCode ?? '').trim();
    if (!code) throw new BadRequestException('نوع مدرک مشخص نشده است');
    if (!claimDocOk(file) && !(code === BENEFICIARY_FILE && EXCEL_MIME.has(file.mimetype))) throw new BadRequestException(CLAIM_DOC_TYPES_FA);
    const tenantId = await this.tenantOn();
    await this.own(tenantId, id);
    const storageKey = await this.storage.save(tenantId, file.buffer);
    const d = await this.db().spareDocument.create({
      data: { caseId: id, tenantId, docCode: code, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey, uploadedBy: getContext()?.actorId ?? null },
    });
    await this.audit.record({ action: AuditAction.CREATE, tenantId, targetType: 'SpareDocument', targetId: d.id, metadata: { caseId: id, docCode: code } });
    return this.presentDoc(d);
  }

  async file(id: string, docId: string) {
    const tenantId = await this.tenantOn();
    await this.own(tenantId, id);
    return this.readFile(tenantId, id, docId);
  }

  private async readFile(tenantId: string, caseId: string, docId: string) {
    const d = await this.db().spareDocument.findFirst({ where: { id: docId, caseId, tenantId } });
    if (!d) throw new NotFoundException('مدرک یافت نشد');
    return { buffer: await this.storage.read(d.storageKey), mimeType: d.mimeType, fileName: d.fileName };
  }

  async removeDocument(id: string, docId: string) {
    const tenantId = await this.tenantOn();
    await this.own(tenantId, id);
    const d = await this.db().spareDocument.findFirst({ where: { id: docId, caseId: id, tenantId } });
    if (!d) throw new NotFoundException('مدرک یافت نشد');
    await this.db().spareDocument.delete({ where: { id: docId } });
    await this.storage.remove(d.storageKey).catch(() => {});
    await this.audit.record({ action: AuditAction.DELETE, tenantId, targetType: 'SpareDocument', targetId: docId, metadata: { caseId: id } });
    return { ok: true };
  }

  // ── Excel: the same columns as «ورود دسته‌ای», every valid row becomes a case of the chosen kind ──

  async importPreview(file: Express.Multer.File) {
    await this.tenantOn();
    const rows = await this.importer.parseRows(file);
    return {
      summary: { total: rows.length, valid: rows.filter((r) => !r.errors.length).length, invalid: rows.filter((r) => r.errors.length).length },
      rows: rows.slice(0, 200).map((r) => ({ row: r.row, fullName: r.data.fullName ?? '', nationalCode: r.data.nationalCode ?? '', errors: r.errors })),
    };
  }

  async importCommit(file: Express.Multer.File, claimType: string) {
    const tenantId = await this.tenantOn();
    if (!(await this.caseTypes(tenantId)).some((t) => t.code === claimType)) throw new BadRequestException('نوع پرونده را انتخاب کنید');
    const rows = await this.importer.parseRows(file);
    let created = 0; let duplicates = 0; let invalid = 0;
    const existing = await this.db().spareCase.findMany({ where: { tenantId, claimType, deletedAt: null }, select: { values: true } });
    const eventKey = (v: Record<string, string>) => `${v.national_code ?? ''}|${v.death_date ?? ''}`;
    const seen = new Set(existing.map((c) => eventKey(this.valuesOf(c))));
    for (const r of rows) {
      if (r.errors.length) { invalid++; continue; }
      const values: Record<string, string> = Object.fromEntries(this.importer.fieldValuesOf(r).map((f) => [f.key, f.value]));
      values[SOURCE_ROW] = JSON.stringify(r.raw); // every column of the file, for the later move into the hierarchy
      if (seen.has(eventKey(values))) { duplicates++; continue; }
      seen.add(eventKey(values));
      await this.db().spareCase.create({ data: { tenantId, claimType, imported: true, ...this.sealed(values), createdById: getContext()?.actorId ?? null } });
      created++;
    }
    await this.audit.record({ action: AuditAction.CREATE, tenantId, targetType: 'SpareImport', metadata: { claimType, created, duplicates, invalid } });
    return { created, duplicates, invalid };
  }

  // ── Sharing with a بیمه‌گزار company (read-only there); companyId null takes it back ──

  async share(ids: string[], companyId: string | null) {
    const tenantId = await this.tenantOn();
    if (companyId && !(await this.db().policyholderCompany.findFirst({ where: { id: companyId, tenantId }, select: { id: true } }))) throw new BadRequestException('بیمه‌گزار نامعتبر است');
    const r = await this.db().spareCase.updateMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, data: { sharedCompanyId: companyId, sharedAt: companyId ? new Date() : null } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId, targetType: 'SpareShare', metadata: { ids, companyId, updated: r.count } });
    return { updated: r.count };
  }

  private async customerCompany() {
    const ctx = getContext();
    if (ctx?.actorType !== 'CUSTOMER' || !ctx.actorId || !ctx.tenantId) throw new ForbiddenException('فقط برای بیمه‌گزار');
    const acc = await this.db().customerAccount.findUnique({ where: { id: ctx.actorId }, select: { companyId: true } });
    const t = await this.db().tenant.findUnique({ where: { id: ctx.tenantId }, select: { spareDeskEnabled: true } });
    return { tenantId: ctx.tenantId, companyId: t?.spareDeskEnabled ? acc?.companyId ?? null : null };
  }

  async sharedList() {
    const { tenantId, companyId } = await this.customerCompany();
    if (!companyId) return [];
    const rows = await this.db().spareCase.findMany({ where: { tenantId, sharedCompanyId: companyId, deletedAt: null }, orderBy: { seq: 'desc' }, take: 1000 });
    const [types, companies] = await Promise.all([this.caseTypes(tenantId), this.companyNames(tenantId)]);
    return rows.map((c) => this.present(c, types, companies.map));
  }

  private async sharedCase(id: string) {
    const { tenantId, companyId } = await this.customerCompany();
    const c = companyId ? await this.db().spareCase.findFirst({ where: { id, tenantId, sharedCompanyId: companyId, deletedAt: null } }) : null;
    if (!c) throw new NotFoundException('پرونده یافت نشد');
    return { c, tenantId };
  }

  async sharedDetail(id: string) {
    const { c, tenantId } = await this.sharedCase(id);
    const v = this.valuesOf(c);
    const [defs, checklist, types, companies] = await Promise.all([this.fieldDefs(tenantId), this.checklistOf(tenantId, c.id, c.claimType), this.caseTypes(tenantId), this.companyNames(tenantId)]);
    return {
      ...this.present(c, types, companies.map),
      fields: defs.filter((d) => v[d.key]).map((d) => ({ key: d.key, label: d.label, type: d.type, value: v[d.key] })),
      documents: [...checklist.items.flatMap((i) => i.documents.map((f) => ({ ...f, label: i.label }))), ...checklist.otherDocuments.map((f) => ({ ...f, label: f.fileName }))],
    };
  }

  async sharedFile(id: string, docId: string) {
    const { c, tenantId } = await this.sharedCase(id);
    return this.readFile(tenantId, c.id, docId);
  }
}
