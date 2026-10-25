import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimPartyType, FieldSource } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';
import { validateField } from '../../common/validation/field-validation';

export interface OcrDraftField {
  key: string;
  value: string;
  confidence: number;
}

@Injectable()
export class ClaimFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldCryptoService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  private async loadClaim(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    return claim;
  }

  /** The party (authority) the caller acts as on this claim. */
  private callerParty(claim: any): ClaimPartyType | null {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER' && claim.policyHolderId === ctx.actorId) return 'POLICYHOLDER';
    if (ctx?.actorType === 'ORG_USER') {
      if (ctx.tenantId === claim.insurerTenantId) return 'INSURER_LEVEL';
      if (ctx.tenantId === claim.brokerTenantId) return 'MOAREF';
    }
    if (ctx?.actorType === 'SUPER_ADMIN') return 'INSURER_LEVEL';
    return null;
  }

  private party(claim: any): ClaimPartyType {
    const p = this.callerParty(claim);
    if (!p) throw new ForbiddenException('دسترسی به این پرونده ندارید');
    return p;
  }

  /** Field definitions (grouped) with the claim's current values, provenance, and edit rights. */
  async listForClaim(claimId: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const defs = await this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, orderBy: { order: 'asc' } });
    const values = await this.db().claimFieldValue.findMany({ where: { claimId } });
    const vmap = new Map(values.map((v) => [v.key, v]));
    const fallback = await this.claimFacts(claim);

    const groups: Record<string, any[]> = { CLAIM_DATA: [], BENEFICIARY: [], WORKFLOW_STAGE: [] };
    for (const d of defs) {
      const v = vmap.get(d.key);
      // An empty field shows what the claim itself already knows (filled at filing or by import),
      // marked source CLAIM so the edit form can store it on the next save.
      const fb = !v?.value ? fallback[d.key] ?? null : null;
      groups[d.group].push({
        key: d.key,
        label: d.label,
        type: d.type,
        options: d.options,
        required: d.required,
        value: v?.value ?? fb,
        source: fb ? 'CLAIM' : v?.source ?? null,
        confidence: v?.confidence ?? null,
        confirmed: !!v?.confirmedAt,
        canEdit: d.editableBy.includes(party),
      });
    }
    return { claimId, party, groups };
  }

  /**
   * Every field value of a claim as a plain map — stored values first, then what the case and its
   * recorded hand-offs imply. No party check: callers (the OTP-verified inquiry) have already proven access.
   */
  async effectiveValues(claimId: string): Promise<Record<string, string>> {
    const claim = await this.loadClaim(claimId);
    const [values, facts] = await Promise.all([this.db().claimFieldValue.findMany({ where: { claimId } }), this.claimFacts(claim)]);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(facts)) if (v) out[k] = v;
    for (const v of values) if (v.value) out[v.key] = v.value;
    return out;
  }

  /** Field values the claim record already implies (deceased, dates, company, policy number…). */
  private async claimFacts(claim: any): Promise<Record<string, string | null>> {
    const jd = (d: Date | null) => (d ? toJalali(d, false).replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))) : null);
    const company = claim.policyholderCompanyId
      ? (await this.db().policyholderCompany.findUnique({ where: { id: claim.policyholderCompanyId }, select: { name: true } }))?.name ?? null
      : null;
    // Executive steps the workflow itself recorded (each desk's hand-off), so a case moved through the
    // system shows its dates without anyone retyping them. A value typed by an operator always wins.
    const steps = await this.db().claimStep.findMany({ where: { claimId: claim.id, decidedAt: { not: null } }, orderBy: { order: 'asc' }, select: { stage: true, action: true, direction: true, purpose: true, decidedAt: true } });
    const first = (pred: (s: (typeof steps)[number]) => boolean) => steps.find(pred) ?? null;
    const last = (pred: (s: (typeof steps)[number]) => boolean) => [...steps].reverse().find(pred) ?? null;
    const brokerFwd = first((s) => s.stage === 'BROKER' && s.action === 'FORWARD');
    const branchFwd = first((s) => s.stage === 'BRANCH' && s.action === 'FORWARD');
    const returned = last((s) => s.action === 'RETURN' || s.action === 'RETURN_DIRECT');
    const resubmit = returned ? steps.find((s) => s.decidedAt! > returned.decidedAt! && s.stage === 'POLICYHOLDER' && s.action === 'SUBMIT') ?? null : null;
    const council = first((s) => s.stage === 'COUNCIL' && (s.action === 'PAY_ORDER' || s.action === 'REJECT_FINAL'));
    const payOrder = first((s) => s.action === 'PAY_ORDER');
    const toBranch = first((s) => s.stage === 'HQ' && s.direction === 'DOWN' && s.purpose === 'PAYMENT');
    const paid = first((s) => s.action === 'MARK_PAID');
    const at = (s: { decidedAt: Date | null } | null) => (s?.decidedAt ? jd(s.decidedAt) : null);
    const flow: Record<string, string | null> = {
      broker_to_insurer_date: at(brokerFwd),
      broker_to_insurer_status: brokerFwd ? 'پرونده و مدارک به بیمه‌گر ارسال شد' : null,
      missing_docs_request_date: at(returned),
      missing_docs_request_status: returned ? (resubmit ? 'رفع شد' : 'کسری اعلام شد') : null,
      send_to_hq_date: at(branchFwd),
      send_to_hq_status: branchFwd ? 'ارسال شد' : null,
      council_approve_date: at(council),
      council_approve_status: council ? (council.action === 'PAY_ORDER' ? 'پرونده تایید شد' : 'رد شد') : null,
      return_to_branch_date: at(toBranch),
      return_to_branch_status: toBranch ? 'پرونده جهت مجوز پرداخت به شعبه برگشته' : null,
      payment_order_date: at(payOrder),
      payment_order_status: paid ? 'پرداخت شد' : payOrder ? 'حواله پرداخت ثبت شد' : null,
      case_notes: claim.status === 'PAID' ? 'پرداخت شده' : claim.status === 'REJECTED' ? 'غیر قابل پرداخت' : null,
    };
    return {
      ...flow,
      full_name: claim.deceasedFullName ? this.crypto.decrypt(claim.deceasedFullName) : null,
      national_code: claim.deceasedNationalCode ? this.crypto.decrypt(claim.deceasedNationalCode) : null,
      birth_date: jd(claim.deceasedBirthDate),
      death_date: jd(claim.eventDate),
      company_name: company ?? claim.employerName ?? null,
      policy_number: claim.policyNumber ?? null,
      cause_of_death: claim.causeOfDeath ?? null,
      beneficiary_type: claim.beneficiaryType ?? null,
    };
  }

  /** Human sets/corrects a field value (validated, provenance recorded, implicitly confirmed). */
  async setValue(claimId: string, key: string, value: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const def = await this.db().claimFieldDef.findFirst({ where: { tenantId: claim.insurerTenantId, key } });
    if (!def) throw new NotFoundException('فیلد تعریف نشده است');
    if (!def.editableBy.includes(party)) throw new ForbiddenException('اجازه ویرایش این فیلد را ندارید');

    const maxAmount = key === 'payable_amount' ? await this.sumInsuredCeiling(claimId) : undefined;
    const check = validateField(def.type, value, { options: def.options, maxAmount });
    if (!check.valid) throw new BadRequestException(check.message);

    const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key } } });
    const source: FieldSource = existing?.source === 'OCR' ? 'OCR_CORRECTED' : 'MANUAL';
    const actor = getContext()?.actorId ?? null;
    const saved = await this.db().claimFieldValue.upsert({
      where: { claimId_key: { claimId, key } },
      update: { value, source, confirmedById: actor, confirmedAt: new Date(), updatedById: actor },
      create: { claimId, key, value, source, confirmedById: actor, confirmedAt: new Date(), updatedById: actor },
    });
    await this.syncPolicyNumber(claimId, key, saved.value);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimField', targetId: claimId, metadata: { key, source } });
    return { key, value: saved.value, source: saved.source, confirmed: true };
  }

  /** Confirm an OCR draft as-is (the human accepts the extracted value without editing). */
  async confirmValue(claimId: string, key: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const def = await this.db().claimFieldDef.findFirst({ where: { tenantId: claim.insurerTenantId, key } });
    if (!def || !def.editableBy.includes(party)) throw new ForbiddenException('اجازه تایید این فیلد را ندارید');
    const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key } } });
    if (!existing) throw new NotFoundException('مقداری برای تایید وجود ندارد');
    const actor = getContext()?.actorId ?? null;
    await this.db().claimFieldValue.update({ where: { claimId_key: { claimId, key } }, data: { confirmedById: actor, confirmedAt: new Date() } });
    await this.syncPolicyNumber(claimId, key, existing.value);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimFieldConfirm', targetId: claimId, metadata: { key } });
    return { key, confirmed: true };
  }

  /**
   * A human-confirmed شماره بیمه‌نامه also lands on the claim itself: from then on the case is titled by it
   * (instead of its internal CLM number) in every list and page.
   */
  private async syncPolicyNumber(claimId: string, key: string, value: string | null) {
    if (key !== 'policy_number') return;
    await this.db().claim.update({ where: { id: claimId }, data: { policyNumber: value?.trim() || null } });
  }

  /**
   * Ingest OCR-extracted draft values (shadow mode): fill only blank or unconfirmed fields, and
   * NEVER overwrite a human-confirmed value. Everything stays unconfirmed until a human confirms.
   */
  async ingestOcrDraft(claimId: string, sourceDocId: string, fields: OcrDraftField[]) {
    const claim = await this.loadClaim(claimId);
    const defKeys = new Set((await this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, select: { key: true } })).map((d) => d.key));
    let drafted = 0;
    for (const f of fields) {
      if (!defKeys.has(f.key)) continue;
      const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key: f.key } } });
      if (existing?.confirmedAt) continue; // never overwrite confirmed human data
      await this.db().claimFieldValue.upsert({
        where: { claimId_key: { claimId, key: f.key } },
        update: { value: f.value, source: 'OCR', confidence: f.confidence, sourceDocId, confirmedById: null, confirmedAt: null },
        create: { claimId, key: f.key, value: f.value, source: 'OCR', confidence: f.confidence, sourceDocId, confirmedById: null, confirmedAt: null },
      });
      drafted++;
    }
    if (drafted) await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimFieldOCR', targetId: claimId, metadata: { drafted, sourceDocId } });
    return { drafted };
  }

  /** The ceiling for مبلغ قابل پرداخت: the larger of سرمایه فوت / سرمایه حادثه, if set. */
  private async sumInsuredCeiling(claimId: string): Promise<number | undefined> {
    const vals = await this.db().claimFieldValue.findMany({ where: { claimId, key: { in: ['death_capital', 'accident_capital'] } } });
    const nums = vals.map((v) => Number((v.value ?? '').replace(/[^\d.]/g, ''))).filter((n) => !Number.isNaN(n) && n > 0);
    return nums.length ? Math.max(...nums) : undefined;
  }
}
