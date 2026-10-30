import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimPartyType, FieldSource } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { fromJalali, toJalali } from '../../common/jalali/jalali.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { customerOwnsClaim, getContext } from '../../common/tenant/tenant-context';
import { validateField } from '../../common/validation/field-validation';
import { Stage, STAGE_FA } from '../claims/workflow';

/** What each hand-off did, for «تاریخچه وضعیت پرونده» of a case moved by the hierarchy. */
const STEP_ACTION_FA: Record<string, string> = {
  SUBMIT: 'ارسال پرونده', FORWARD: 'تایید و ارسال به مرحلهٔ بعد', REFER_COUNCIL: 'ارجاع به شورای فنی', PAY_ORDER: 'دستور پرداخت',
  RETURN: 'عودت برای رفع نقص', RETURN_DIRECT: 'برگشت از سرپرستی به بیمه‌گزار', DOWN_FORWARD: 'ارسال به مرحلهٔ پایین‌تر',
  DOWN_DIRECT: 'ارسال مستقیم به بیمه‌گزار', MARK_PAID: 'پرداخت خسارت', REJECT_FINAL: 'رد نهایی پرونده',
};
const STEP_STATE_FA: Record<string, string> = {
  FORWARDED: 'تایید و ارسال', ESCALATED: 'ارجاع به سطح بالاتر', APPROVED: 'تایید شد', RETURNED_INCOMPLETE: 'عودت برای رفع نقص', REJECTED: 'رد شد', ACKED: 'دریافت و ارسال',
};

/**
 * The executive-stage fields («مراحل اجرایی» dates and statuses, «وضعیت پرونده», «حواله پرداخت»). Once an
 * operator has typed any of them for a case, the case is hand-completed: every workflow view shows only
 * what was typed, and nothing is filled in from the hierarchy's own hand-offs.
 */
export const MANUAL_FLOW_KEYS = new Set([
  'death_notice_date', 'death_notice_status', 'broker_to_insurer_date', 'broker_to_insurer_status',
  'docs_request_date', 'docs_request_status', 'docs_receive_date', 'docs_receive_status',
  'missing_docs_request_date', 'missing_docs_request_status', 'case_complete', 'case_complete_date', 'case_complete_status',
  'send_to_hq_date', 'send_to_hq_status', 'return_to_branch_date', 'return_to_branch_status',
  'council_approve_date', 'council_approve_status', 'payment_order_date', 'payment_order_status', 'payment_order', 'case_stage',
]);

/** Fields the hierarchy fills from its own hand-offs (see claimFacts) — shown, never auto-saved. */
const FLOW_DERIVED = new Set([...MANUAL_FLOW_KEYS, 'execution_stages', 'case_notes']);

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
    if (ctx?.actorType === 'CUSTOMER' && customerOwnsClaim(claim)) return 'POLICYHOLDER';
    if (ctx?.actorType === 'ORG_USER') {
      if (ctx.tenantId === claim.insurerTenantId) return 'INSURER_LEVEL';
      if (ctx.tenantId === claim.brokerTenantId) return 'MOAREF';
    }
    if (ctx?.actorType === 'SUPER_ADMIN') return 'INSURER_LEVEL';
    return null;
  }

  /**
   * «تکمیل دستی پرونده»: the brokerage's own staff (the claim's معرف) may fill every field — the
   * insurer-side stage fields too — when super admin hasn't locked it for the brokerage. Insurer
   * staff never get this; their rights stay exactly as the field catalog says.
   */
  async manualMode(claim: { brokerTenantId: string | null }): Promise<boolean> {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER' || !ctx.tenantId || ctx.tenantId !== claim.brokerTenantId) return false;
    const t = await this.db().tenant.findUnique({ where: { id: ctx.tenantId }, select: { kind: true, manualCompletion: true } });
    return t?.kind === 'BROKER' && t.manualCompletion;
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
    const manual = await this.manualMode(claim);
    const defs = await this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, orderBy: { order: 'asc' } });
    const values = await this.db().claimFieldValue.findMany({ where: { claimId } });
    const vmap = new Map(values.map((v) => [v.key, v]));
    const fallback = await this.claimFacts(claim);

    const groups: Record<string, any[]> = { CLAIM_DATA: [], BENEFICIARY: [], WORKFLOW_STAGE: [] };
    for (const d of defs) {
      const v = vmap.get(d.key);
      // An empty field shows what the claim itself already knows (filled at filing or by import),
      // marked source CLAIM so the edit form can store it on the next save. Values derived from the
      // hierarchy's hand-offs are marked FLOW instead: they are NOT stored on save (that would freeze the
      // case as hand-completed and hide every later step) — only a value someone actually changes is.
      const fb = !v?.value ? fallback[d.key] ?? null : null;
      const fbSource = FLOW_DERIVED.has(d.key) ? 'FLOW' : 'CLAIM';
      groups[d.group].push({
        key: d.key,
        label: d.label,
        type: d.type,
        options: d.options,
        required: d.required,
        value: v?.value ?? fb,
        source: fb ? fbSource : v?.source ?? null,
        confidence: v?.confidence ?? null,
        confirmed: !!v?.confirmedAt,
        canEdit: manual || d.editableBy.includes(party),
      });
    }
    return { claimId, party, manual, groups };
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
  /**
   * Hand-completed? — some stage field holds a typed value (a confirmed one; an unconfirmed OCR guess
   * doesn't count). Then «ویرایش» has priority over the hierarchy in every view of the case.
   */
  async isManual(claimId: string): Promise<boolean> {
    const n = await this.db().claimFieldValue.count({
      where: { claimId, key: { in: [...MANUAL_FLOW_KEYS] }, value: { not: null }, NOT: { value: '' }, source: { not: 'OCR' } },
    });
    return n > 0;
  }

  /**
   * «تاریخچه وضعیت پرونده» of a hand-completed case: every stage value typed in «ویرایش», oldest first,
   * with the field's label and Tehran date/time.
   */
  async manualHistory(claim: { id: string; insurerTenantId: string }) {
    const [logs, defs] = await Promise.all([
      this.db().claimFieldLog.findMany({ where: { claimId: claim.id, key: { in: [...MANUAL_FLOW_KEYS] } }, orderBy: { createdAt: 'asc' } }),
      this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId }, select: { key: true, label: true, type: true } }),
    ]);
    const d = new Map(defs.map((x) => [x.key, x]));
    return logs.filter((l) => l.value).map((l) => ({
      at: toJalali(l.createdAt, true, true), key: l.key, label: d.get(l.key)?.label ?? l.key,
      value: d.get(l.key)?.type === 'DATE' ? toJalali(this.isoOfJalali(l.value!) ?? l.createdAt, false) : l.value!,
    }));
  }

  /**
   * Which story the workflow views tell, and its timeline («تاریخچه وضعیت پرونده»):
   *  - hand-completed (something typed in «ویرایش»): «وضعیت پرونده» and the stage values as typed, in order;
   *  - otherwise the hierarchy: filing, then every desk's hand-off with its Tehran date and time.
   * Completed imported (historical) cases don't list a filing date — it's only the date they were brought in.
   */
  async statusStory(claim: { id: string; insurerTenantId: string; createdAt: Date; imported?: boolean; status?: string }) {
    const manual = await this.isManual(claim.id);
    if (manual) {
      const [rows, stage] = await Promise.all([
        this.manualHistory(claim),
        this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId: claim.id, key: 'case_stage' } }, select: { value: true } }),
      ]);
      return { manual, caseStage: stage?.value || null, history: rows.map((r) => ({ at: r.at, title: r.label, detail: r.value })) };
    }
    const steps = await this.db().claimStep.findMany({ where: { claimId: claim.id, decidedAt: { not: null } }, orderBy: { order: 'asc' } });
    const history = [
      ...(claim.imported && (claim.status === 'PAID' || claim.status === 'REJECTED') ? [] : [{ at: toJalali(claim.createdAt, true, true), title: 'ثبت پرونده', detail: null as string | null }]),
      ...steps.map((s) => ({
        at: toJalali(s.decidedAt!, true, true),
        title: `${s.stage ? STAGE_FA[s.stage as Stage] : 'مرحله'}: ${STEP_ACTION_FA[s.action ?? ''] ?? STEP_STATE_FA[s.state] ?? s.state}`,
        detail: s.note ?? null,
      })),
    ];
    return { manual, caseStage: null, history };
  }

  /** A typed Jalali date "1405/08/05" back to a Date (for display only; null when it isn't one). */
  private isoOfJalali(v: string): Date | null {
    const m = v.replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    return m ? fromJalali(`${m[1]}/${m[2]}/${m[3]}`) : null;
  }

  private async claimFacts(claim: any): Promise<Record<string, string | null>> {
    const jd = (d: Date | null) => (d ? toJalali(d, false).replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))) : null);
    const company = claim.policyholderCompanyId
      ? (await this.db().policyholderCompany.findUnique({ where: { id: claim.policyholderCompanyId }, select: { name: true } }))?.name ?? null
      : null;
    // Executive steps the workflow itself recorded (each desk's hand-off), so a case moved through the
    // system shows its dates without anyone retyping them. A value typed by an operator always wins.
    const [allSteps, physical] = await Promise.all([
      this.db().claimStep.findMany({ where: { claimId: claim.id }, orderBy: { order: 'asc' }, select: { stage: true, action: true, direction: true, purpose: true, decidedAt: true, createdAt: true } }),
      this.db().claimPhysicalRequest.findMany({ where: { claimId: claim.id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, receivedAt: true } }),
    ]);
    const steps = allSteps.filter((s) => s.decidedAt);
    const first = (pred: (s: (typeof steps)[number]) => boolean) => steps.find(pred) ?? null;
    const last = (pred: (s: (typeof steps)[number]) => boolean) => [...steps].reverse().find(pred) ?? null;
    const submitted = first((s) => s.stage === 'POLICYHOLDER' && s.action === 'SUBMIT');
    const brokerFwd = first((s) => s.stage === 'BROKER' && s.action === 'FORWARD');
    const branchFwd = first((s) => s.stage === 'BRANCH' && s.action === 'FORWARD');
    const returned = last((s) => s.action === 'RETURN' || s.action === 'RETURN_DIRECT');
    const resubmit = returned ? steps.find((s) => s.decidedAt! > returned.decidedAt! && s.stage === 'POLICYHOLDER' && s.action === 'SUBMIT') ?? null : null;
    // شورای فنی: referred by ستاد; its own decision (payment order / rejection) when it made one.
    const referred = first((s) => s.action === 'REFER_COUNCIL');
    const council = first((s) => s.stage === 'COUNCIL' && (s.action === 'PAY_ORDER' || s.action === 'REJECT_FINAL'));
    const payOrder = first((s) => s.action === 'PAY_ORDER');
    // «برگشت به شعبه»: the payment order reached شعبه (the شعبه step opened for the payment).
    const toBranch = allSteps.find((s) => s.stage === 'BRANCH' && s.purpose === 'PAYMENT') ?? null;
    const paid = first((s) => s.action === 'MARK_PAID');
    const rejected = first((s) => s.action === 'REJECT_FINAL');
    // Originals («اصل مدارک»): asked for, then received.
    const physAsked = physical[0] ?? null;
    const physGot = physical.find((p) => p.receivedAt) ?? null;
    const at = (s: { decidedAt: Date | null } | null) => (s?.decidedAt ? jd(s.decidedAt) : null);
    const stageNow = claim.status === 'PAID' ? 'پرداخت شده' : claim.status === 'REJECTED' ? 'رد شده'
      : claim.flowPurpose === 'PAYMENT' ? 'در انتظار پرداخت'
      : claim.currentStage ? `نزد ${claim.currentStage === 'POLICYHOLDER' ? 'بیمه‌گزار' : claim.currentStage === 'HQ' ? 'مدیریت ستاد' : STAGE_FA[claim.currentStage as Stage]}` : null;
    const manual = await this.isManual(claim.id);
    const hierarchy: Record<string, string | null> = {
      // The death is reported when the case is filed (by the بیمه‌گزار, or by staff for them).
      death_notice_date: jd(submitted?.decidedAt ?? claim.createdAt),
      death_notice_status: 'انجام شد',
      broker_to_insurer_date: at(brokerFwd),
      broker_to_insurer_status: brokerFwd ? 'پرونده و مدارک به بیمه‌گر ارسال شد' : null,
      execution_stages: stageNow,
      docs_request_date: physAsked ? jd(physAsked.createdAt) : null,
      docs_request_status: physAsked ? 'مدارک درخواست شد' : null,
      // Received: the originals, or (when none were asked for) the documents the بیمه‌گزار sent in.
      docs_receive_date: physAsked ? (physGot ? jd(physGot.receivedAt) : null) : at(submitted),
      docs_receive_status: physAsked ? (physGot ? 'مدارک دریافت شد' : null) : submitted ? 'مدارک دریافت شد' : null,
      missing_docs_request_date: at(returned),
      missing_docs_request_status: returned ? (resubmit ? 'رفع شد' : 'کسری اعلام شد') : null,
      // Complete once شعبه has approved every document and sent the case on.
      case_complete_date: at(branchFwd),
      case_complete: branchFwd ? 'تکمیل' : null,
      case_complete_status: branchFwd ? 'پرونده تکمیل شده و کسری ندارد' : null,
      send_to_hq_date: at(branchFwd),
      send_to_hq_status: branchFwd ? 'ارسال شد' : null,
      council_approve_date: at(council) ?? (referred && (claim.status === 'PAID' || payOrder) ? at(payOrder) : at(referred)),
      council_approve_status: council ? (council.action === 'PAY_ORDER' ? 'پرونده تایید شد' : 'رد شد')
        : referred ? (payOrder ? 'پرونده تایید شد' : rejected ? 'رد شد' : 'در حال بررسی') : null,
      return_to_branch_date: toBranch ? jd(toBranch.createdAt) : null,
      return_to_branch_status: toBranch ? 'پرونده جهت مجوز پرداخت به شعبه برگشته' : null,
      payment_order_date: at(payOrder),
      payment_order_status: paid ? 'پرداخت شد' : payOrder ? 'حواله پرداخت ثبت شد' : null,
      payment_order: payOrder && claim.finalizedAmount != null ? String(claim.finalizedAmount) : null,
      case_stage: stageNow,
      case_notes: claim.status === 'PAID' ? 'پرداخت شده' : claim.status === 'REJECTED' ? 'غیر قابل پرداخت' : null,
    };
    // A hand-completed case shows only what the operator typed (no dates/statuses from the hand-offs).
    const flow: Record<string, string | null> = manual ? { case_notes: hierarchy.case_notes } : hierarchy;
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
    if (!def.editableBy.includes(party) && !(await this.manualMode(claim))) throw new ForbiddenException('اجازه ویرایش این فیلد را ندارید');

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
    if (MANUAL_FLOW_KEYS.has(key) && (existing?.value ?? '') !== (saved.value ?? '')) {
      await this.db().claimFieldLog.create({ data: { claimId, key, value: saved.value, byId: actor } });
    }
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
