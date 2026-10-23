/**
 * Claim chain (workflow v2) — pure rules, no I/O. See docs/CLAIMS-WORKFLOW.md.
 *
 *   بیمه‌گزار → کارگزاری → شعبه → مدیریت ستاد → (شورای فنی)
 *
 * Going UP each desk reviews the documents and forwards; going DOWN a return (رفع نقص) or a payment
 * order is handed on desk by desk by an operator, each press labelled with the next desk's name.
 * DIRECT-channel claims (no brokerage) skip کارگزاری.
 */
export type Stage = 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';
export type Direction = 'UP' | 'DOWN';
export type Purpose = 'REVIEW' | 'DEFICIENCY' | 'PAYMENT';
/** Desks that review documents (have a ✓/✕ column per document). */
export type ReviewDesk = Exclude<Stage, 'POLICYHOLDER'>;

export const STAGE_FA: Record<Stage, string> = {
  POLICYHOLDER: 'بیمه‌گزار',
  BROKER: 'کارگزاری',
  BRANCH: 'شعبه',
  HQ: 'مدیریت ستاد',
  COUNCIL: 'شورای فنی',
};

export type ActionKey =
  | 'SUBMIT' // بیمه‌گزار → first reviewer (initial filing or after رفع نقص)
  | 'FORWARD' // کارگزاری → شعبه, شعبه → ستاد
  | 'REFER_COUNCIL' // ستاد → شورای فنی
  | 'PAY_ORDER' // ستاد → شعبه / شورا → ستاد, as a payment order
  | 'RETURN' // return for fixes to the desk below
  | 'RETURN_DIRECT' // admin: return straight to بیمه‌گزار
  | 'DOWN_FORWARD' // hand a return / payment order on to the desk below
  | 'DOWN_DIRECT' // admin: hand a return straight to بیمه‌گزار
  | 'MARK_PAID' // شعبه records the payout to the beneficiary
  | 'REJECT_FINAL'; // substantive rejection (not covered etc.)

export interface WorkflowAction {
  key: ActionKey;
  label: string;
  tone: 'primary' | 'warning' | 'danger' | 'ghost';
  disabled?: string; // reason the action can't be taken yet
  adminOnly?: boolean;
  needsDeficiencies?: boolean; // ask for deficiency lines (required when nothing was rejected)
  needsNote?: boolean;
  branchOptions?: { id: string; name: string; code: string }[]; // کارگزاری picks the insurer's شعبه
  selectedBranchId?: string | null;
}

const ORDER: Stage[] = ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'];

export function rank(s: Stage): number {
  return ORDER.indexOf(s);
}

/** The desks this claim passes through, bottom → top. */
export function chainOf(claim: { brokerTenantId: string | null }): Stage[] {
  return claim.brokerTenantId ? ORDER : ORDER.filter((s) => s !== 'BROKER');
}

export function below(claim: { brokerTenantId: string | null }, s: Stage): Stage | null {
  const c = chainOf(claim);
  const i = c.indexOf(s);
  return i > 0 ? c[i - 1] : null;
}

export function above(claim: { brokerTenantId: string | null }, s: Stage): Stage | null {
  const c = chainOf(claim);
  const i = c.indexOf(s);
  return i >= 0 && i < c.length - 1 ? c[i + 1] : null;
}

export function higher(a: Stage | null | undefined, b: Stage): Stage {
  return a && rank(a) > rank(b) ? a : b;
}

/** Facts about the claim's documents at the current desk, computed by the service. */
export interface DeskDocFacts {
  count: number; // latest documents on file
  allApproved: boolean; // every latest document approved at this desk
  rejectedLabels: string[]; // latest documents rejected at this desk
  rejectedAnywhere: string[]; // latest documents rejected at any desk (must be replaced before SUBMIT)
}

export interface ActionContext {
  claim: {
    brokerTenantId: string | null;
    status: string;
    currentStage: Stage | null;
    flowDirection: Direction | null;
    flowPurpose: Purpose | null;
    returnTargetStage: Stage | null;
    lossNoticeNumber: string | null;
    finalizedAmount: { toString(): string } | null;
    claimedAmount: { toString(): string };
    handlingBranchId: string | null;
  };
  isAdmin: boolean; // claim:override — management discretion
  hqCeiling: { toString(): string } | null;
  docs: DeskDocFacts;
  branches: { id: string; name: string; code: string }[]; // insurer branches (for کارگزاری → شعبه)
}

/**
 * The actions available to the desk that currently holds the claim. The caller must already have
 * checked that the actor sits at `claim.currentStage` (and at the right branch / org).
 */
export function actionsFor(ctx: ActionContext): WorkflowAction[] {
  const { claim, docs } = ctx;
  const s = claim.currentStage;
  if (!s || ['PAID', 'REJECTED'].includes(claim.status)) return [];
  const out: WorkflowAction[] = [];
  const dn = below(claim, s);
  const up = above(claim, s);
  const notApproved = docs.count === 0 ? 'مدرکی بارگذاری نشده است' : !docs.allApproved ? `ابتدا همهٔ مدارک را در مرحلهٔ ${STAGE_FA[s]} تایید کنید` : undefined;

  if (s === 'POLICYHOLDER') {
    const disabled = docs.count === 0
      ? 'ابتدا مدارک را بارگذاری کنید'
      : docs.rejectedAnywhere.length
        ? `مدارک ردشده را جایگزین کنید: ${docs.rejectedAnywhere.join('، ')}`
        : undefined;
    if (up) out.push({ key: 'SUBMIT', label: `ارسال به ${STAGE_FA[up]}`, tone: 'primary', disabled });
    return out;
  }

  if (claim.flowDirection === 'DOWN') {
    if (claim.flowPurpose === 'PAYMENT') {
      if (s === 'BRANCH') out.push({ key: 'MARK_PAID', label: 'ثبت پرداخت به ذینفع', tone: 'primary' });
      else if (dn) out.push({ key: 'DOWN_FORWARD', label: `ارسال به ${STAGE_FA[dn]} برای پرداخت`, tone: 'primary' });
      return out;
    }
    if (dn) out.push({ key: 'DOWN_FORWARD', label: `ارسال به ${STAGE_FA[dn]}`, tone: 'primary' });
    if (ctx.isAdmin && dn && dn !== 'POLICYHOLDER') {
      out.push({ key: 'DOWN_DIRECT', label: 'ارسال مستقیم به بیمه‌گزار (اختیار مدیریت)', tone: 'ghost', adminOnly: true });
    }
    return out;
  }

  // ── UP: this desk is reviewing ──
  if (s === 'BROKER' || s === 'BRANCH') {
    let disabled = notApproved;
    if (!disabled && s === 'BRANCH' && !claim.lossNoticeNumber) disabled = 'ابتدا اعلام خسارت را ثبت کنید';
    if (!disabled && s === 'BROKER' && !ctx.branches.length) disabled = 'بیمه‌گر هیچ شعبه‌ای تعریف نکرده است';
    out.push({
      key: 'FORWARD',
      label: `ارسال به ${STAGE_FA[up!]}`,
      tone: 'primary',
      disabled,
      ...(s === 'BROKER' ? { branchOptions: ctx.branches, selectedBranchId: claim.handlingBranchId } : {}),
    });
  } else if (s === 'HQ') {
    const council = { key: 'REFER_COUNCIL' as const, label: 'ارجاع به شورای فنی', tone: 'primary' as const, disabled: notApproved };
    if (claim.returnTargetStage === 'COUNCIL') {
      // شورای فنی returned it — after the fix it must go back to the council, not be paid here.
      out.push({ ...council, label: 'ارسال به شورای فنی' });
    } else {
      const payable = Number((claim.finalizedAmount ?? claim.claimedAmount).toString());
      const ceiling = ctx.hqCeiling != null ? Number(ctx.hqCeiling.toString()) : null;
      let disabled = notApproved;
      if (!disabled && claim.finalizedAmount == null) disabled = 'ابتدا مبلغ خسارت قطعی را ثبت کنید';
      if (!disabled && ceiling != null && payable > ceiling) disabled = 'مبلغ بیش از سقف اختیار مدیریت ستاد است؛ پرونده را به شورای فنی ارجاع دهید';
      out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت — ارسال به شعبه', tone: 'primary', disabled });
      out.push(council);
    }
  } else if (s === 'COUNCIL') {
    let disabled = notApproved;
    if (!disabled && claim.finalizedAmount == null) disabled = 'ابتدا مبلغ خسارت قطعی را ثبت کنید';
    out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت — ارسال به مدیریت ستاد', tone: 'primary', disabled });
  }

  if (dn) {
    out.push({ key: 'RETURN', label: `ارسال به ${STAGE_FA[dn]} (عودت برای رفع نقص)`, tone: 'warning', needsDeficiencies: true });
    if (ctx.isAdmin && dn !== 'POLICYHOLDER') {
      out.push({ key: 'RETURN_DIRECT', label: 'عودت مستقیم به بیمه‌گزار (اختیار مدیریت)', tone: 'ghost', adminOnly: true, needsDeficiencies: true });
    }
  }
  if (s !== 'BROKER') out.push({ key: 'REJECT_FINAL', label: 'رد نهایی پرونده', tone: 'danger', needsNote: true });
  return out;
}
