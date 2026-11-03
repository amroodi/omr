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
  | 'REJECT_FINAL' // substantive rejection (not covered etc.)
  | 'REQUEST_PHYSICAL'; // ask for the original documents (side track — the claim stays put)

export interface WorkflowAction {
  key: ActionKey;
  label: string;
  tone: 'primary' | 'warning' | 'danger' | 'ghost';
  disabled?: string; // reason the action can't be taken yet
  adminOnly?: boolean;
  needsDeficiencies?: boolean; // ask for deficiency lines (required when nothing was rejected)
  confirm?: boolean; // the panel asks «آیا مطمئن هستید؟» (yes / no) before sending — guards against misclicks
  needsNote?: boolean;
  branchOptions?: { id: string; name: string; code: string }[]; // کارگزاری picks the insurer's شعبه
  selectedBranchId?: string | null;
}

const ORDER: Stage[] = ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'];

/**
 * Model View: how one insurer's chain works, set only in Super Admin (`Tenant.workflowModel`).
 * The defaults are the behaviour every insurer had before the model existed.
 */
export interface PanelRights { upload: boolean; submit: boolean }
export interface CaseRules { councilEnabled: boolean; requireLossNotice: boolean; requireOriginals: boolean }
export type FieldMode = 'required' | 'optional' | 'hidden';
export interface LineForm { insuredLabel: string; claimTypes: string[] }
/**
 * نوع بیمه‌شده: the main insured (اصلی) or one of their dependents (فرعی). On a dependent's case the
 * deceased* fields are that person and mainInsured* name the main insured.
 */
export const INSURED_RELATIONS = ['MAIN', 'SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'OTHER'] as const;
export type InsuredRelation = (typeof INSURED_RELATIONS)[number];
export const DEPENDENT_RELATIONS: InsuredRelation[] = ['SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'OTHER'];
export const RELATION_FA: Record<InsuredRelation, string> = { MAIN: 'اصلی', SPOUSE: 'همسر', CHILD: 'فرزند', FATHER: 'پدر', MOTHER: 'مادر', OTHER: 'سایر' };

/** نوع بیمه‌نامه. The last three start with no نوع پرونده: filing opens once Super Admin sets them in Model View. */
export type Line = 'LIFE' | 'ACCIDENT' | 'LIABILITY' | 'CREDIT_LIFE' | 'SAVINGS_LIFE';
export const LINES: Line[] = ['LIFE', 'ACCIDENT', 'LIABILITY', 'CREDIT_LIFE', 'SAVINGS_LIFE'];
/** A `?line=` query value, if it is a نوع بیمه‌نامه (anything else = every kind). */
export const asLine = (v: unknown): Line | undefined => (LINES as unknown[]).includes(v) ? (v as Line) : undefined;
const perLine = <T>(f: (l: Line) => T) => Object.fromEntries(LINES.map((l) => [l, f(l)])) as Record<Line, T>;
/** One نوع پرونده. causeGroup: which cause list it shows; death: the case speaks of a متوفی and takes the ذینفع step. */
export interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean }
/** بیمه‌گزار companies that file different نوع پرونده than the insurer's usual ones (a ticked company covers its subsidiaries). */
export interface CompanyGroup { id: string; label: string; companyIds: string[]; lines: Record<Line, string[]>; dependents: boolean }
/**
 * Where a case the insurer's own staff enter from panel 1 starts: on the کارگزاری's desk (its initial
 * assessment first, as if the brokerage had filed it), straight at the insurer's شعبه, or chosen each time.
 */
export type EntryWay = 'BROKER' | 'BRANCH' | 'ASK';
export const ENTRY_WAYS: EntryWay[] = ['BROKER', 'BRANCH', 'ASK'];
export interface WorkflowModel extends CaseRules {
  stages: Record<Stage, { label: string; reviewDocs: boolean }>; // reviewDocs: must this desk ✓ every document before sending on?
  byType: Record<string, Partial<CaseRules>>; // نوع پرونده → what differs from the rules above
  panels: { COMPANY: PanelRights; REPRESENTATIVE: PanelRights };
  insured: { enabled: boolean; docCodes: string[]; linkDays: number }; // پنل بیمه‌شده: what they upload; how long an invitation lasts
  entry: { way: EntryWay }; // the insurer's own panel-1 filings (see EntryWay)
  form: {
    eventLabel: string;
    birthDate: FieldMode;
    cause: FieldMode;
    causeLists: { DEATH: string[]; ACCIDENT: string[] }; // ticks above the typed cause, by causeGroup
    lines: Record<Line, LineForm>;
    caseTypes: CaseType[];
    groups: CompanyGroup[];
    dependents: boolean; // «نوع بیمه‌شده» (اصلی / همسر / فرزند / پدر / مادر / سایر) on the filing form, for companies outside a group
    docsNote: string; // shown above the document uploads
  };
}
const LIFE_TYPES = ['DEATH_ILLNESS', 'DISABILITY_ILLNESS'];
const ACCIDENT_TYPES = ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL'];
export const DEFAULT_CASE_TYPES: CaseType[] = [
  { code: 'DEATH_ILLNESS', label: 'فوت به هر علت', causeGroup: 'DEATH', death: true },
  { code: 'DISABILITY_ILLNESS', label: 'از کار افتادگی دائم و کامل ناشی از بیماری', causeGroup: 'DEATH', death: false },
  { code: 'DEATH_ACCIDENT', label: 'فوت بر اثر حادثه', causeGroup: 'DEATH', death: true },
  { code: 'DISABILITY_ACCIDENT', label: 'نقص عضو و از کار افتادگی بر اثر حادثه', causeGroup: 'ACCIDENT', death: false },
  { code: 'MEDICAL_ACCIDENT', label: 'جبران هزینه‌های ناشی از حادثه', causeGroup: 'ACCIDENT', death: false },
  { code: 'DAILY_GENERAL', label: 'غرامت روزانه عمومی', causeGroup: 'ACCIDENT', death: false },
  { code: 'DAILY_HOSPITAL', label: 'غرامت روزانه بیمارستانی', causeGroup: 'ACCIDENT', death: false },
];
export const DEFAULT_WORKFLOW_MODEL: WorkflowModel = {
  councilEnabled: true,
  requireLossNotice: true,
  requireOriginals: true,
  stages: {
    POLICYHOLDER: { label: STAGE_FA.POLICYHOLDER, reviewDocs: false },
    BROKER: { label: STAGE_FA.BROKER, reviewDocs: true },
    BRANCH: { label: STAGE_FA.BRANCH, reviewDocs: true },
    HQ: { label: STAGE_FA.HQ, reviewDocs: true },
    COUNCIL: { label: STAGE_FA.COUNCIL, reviewDocs: true },
  },
  byType: {},
  panels: { COMPANY: { upload: true, submit: true }, REPRESENTATIVE: { upload: true, submit: true } },
  insured: { enabled: false, docCodes: [], linkDays: 7 },
  entry: { way: 'BROKER' },
  form: {
    eventLabel: 'تاریخ وقوع',
    birthDate: 'optional',
    cause: 'optional',
    causeLists: {
      DEATH: [
      'بیماری',
      'سرطان',
      'سکته قلبی بدون برگه ذینفع',
      'فوت-عدم تعیین سهم ذینفعها و پرداخت در وجه وراث',
      'انفجار',
      'سکته قلبی-پرداخت در وجه وکیل یا وراث',
      'سکته قلبی-پرداخت در وجه بیمه گذار',
      'سکته مغزی-پرداخت در وجه بیمه گذار',
      'فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"',
      'فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"',
      'ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی تأمین اجتماعی و تائید بیمه‌گر',
      'ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی بیمه گذار',
      'سکته قلبی با برگه ذینفع',
      'سکته مغزی با برگه ذینفع',
      'فوت در اثر حادثه با برگه ذینفع',
      'بیماری کرونا',
      'بیماری های تنفسی',
      'فوت در اثر حادثه-ذینفع "بیمه گذار"',
      ],
      ACCIDENT: [
      'حادثه ناشی از کار',
      'حادثه غیر ناشی از کار (تصادف)',
      'زلزله (با فرم تعیین ذینفع)',
      'زلزله (بدون فرم تعیین ذینفع)',
      'حادثه (با هزینه پزشکی)',
      'حادثه (بدون هزینه پزشکی)',
      ],
    },
    lines: {
      LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: LIFE_TYPES },
      ACCIDENT: { insuredLabel: 'نام بیمه‌شده (مصدوم/متوفی)', claimTypes: ACCIDENT_TYPES },
      LIABILITY: { insuredLabel: 'نام زیان‌دیده', claimTypes: [] },
      CREDIT_LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: [] },
      SAVINGS_LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: [] },
    },
    caseTypes: DEFAULT_CASE_TYPES,
    groups: [{ id: 'copper', label: 'شرکت‌های زیرمجموعه صنایع ملی مس ایران', companyIds: [], lines: { LIFE: LIFE_TYPES, ACCIDENT: ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT'], LIABILITY: [], CREDIT_LIFE: [], SAVINGS_LIFE: [] }, dependents: false }],
    dependents: true,
    docsNote: 'تصاویر مدارک موجود در پرونده باید خوانا و ممهور به مهر برابر اصل توسط مراجع یا مقامات ذی‌صلاح قانونی باشد.',
  },
};

/** The stored model over the defaults; anything missing or malformed keeps its default. */
export function modelFrom(stored: unknown): WorkflowModel {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, any>;
  const d = DEFAULT_WORKFLOW_MODEL;
  const flag = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const text = (v: unknown, def: string, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
  const mode = (v: unknown, def: FieldMode): FieldMode => (v === 'required' || v === 'optional' || v === 'hidden' ? v : def);
  const list = (v: unknown, max = 60) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 120)))].slice(0, max) : []);
  const rights = (r: any, def: PanelRights): PanelRights => ({ upload: flag(r?.upload, def.upload), submit: flag(r?.submit, def.submit) });
  // The standard types always exist (old cases carry their codes); an insurer can rename them and add its own.
  const storedTypes: any[] = Array.isArray(raw.form?.caseTypes) ? raw.form.caseTypes : [];
  const caseType = (r: any, def?: CaseType): CaseType => ({
    code: def?.code ?? r.code, label: text(r?.label, def?.label ?? r.code, 120),
    causeGroup: r?.causeGroup === 'DEATH' || r?.causeGroup === 'ACCIDENT' ? r.causeGroup : def?.causeGroup ?? 'ACCIDENT',
    death: flag(r?.death, def?.death ?? false),
  });
  const caseTypes = [
    ...DEFAULT_CASE_TYPES.map((def) => caseType(storedTypes.find((r) => r?.code === def.code), def)),
    ...storedTypes.filter((r) => typeof r?.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(r.code) && !DEFAULT_CASE_TYPES.some((x) => x.code === r.code)).slice(0, 40).map((r) => caseType(r)),
  ];
  const known = new Set(caseTypes.map((t) => t.code));
  const typeList = (v: unknown, def: string[]) => {
    const types = Array.isArray(v) ? [...new Set(v.filter((t): t is string => known.has(t)))] : def;
    return types.length ? types : def;
  };
  const line = (r: any, def: LineForm): LineForm => ({ insuredLabel: text(r?.insuredLabel, def.insuredLabel), claimTypes: typeList(r?.claimTypes, def.claimTypes) });
  const byType: Record<string, Partial<CaseRules>> = {};
  for (const t of known) {
    const r = raw.byType?.[t];
    if (!r || typeof r !== 'object') continue;
    const o: Partial<CaseRules> = {};
    for (const k of ['councilEnabled', 'requireLossNotice', 'requireOriginals'] as const) if (typeof r[k] === 'boolean') o[k] = r[k];
    if (Object.keys(o).length) byType[t] = o;
  }
  const stages = Object.fromEntries(ORDER.map((st) => [st, {
    label: text(raw.stages?.[st]?.label, d.stages[st].label, 40),
    reviewDocs: st === 'POLICYHOLDER' ? false : flag(raw.stages?.[st]?.reviewDocs, d.stages[st].reviewDocs),
  }])) as WorkflowModel['stages'];
  const days = Number(raw.insured?.linkDays);
  return {
    councilEnabled: flag(raw.councilEnabled, d.councilEnabled),
    requireLossNotice: flag(raw.requireLossNotice, d.requireLossNotice),
    requireOriginals: flag(raw.requireOriginals, d.requireOriginals),
    stages,
    byType,
    panels: { COMPANY: rights(raw.panels?.COMPANY, d.panels.COMPANY), REPRESENTATIVE: rights(raw.panels?.REPRESENTATIVE, d.panels.REPRESENTATIVE) },
    insured: { enabled: flag(raw.insured?.enabled, false), docCodes: list(raw.insured?.docCodes), linkDays: days >= 1 && days <= 60 ? Math.round(days) : d.insured.linkDays },
    entry: { way: ENTRY_WAYS.includes(raw.entry?.way) ? raw.entry.way : d.entry.way },
    form: {
      eventLabel: text(raw.form?.eventLabel, d.form.eventLabel),
      birthDate: mode(raw.form?.birthDate, d.form.birthDate),
      cause: mode(raw.form?.cause, d.form.cause),
      causeLists: {
        // A list saved before there were two: it served every نوع پرونده.
        DEATH: Array.isArray(raw.form?.causeLists?.DEATH) ? list(raw.form.causeLists.DEATH) : list(raw.form?.causes).length ? list(raw.form.causes) : d.form.causeLists.DEATH,
        ACCIDENT: Array.isArray(raw.form?.causeLists?.ACCIDENT) ? list(raw.form.causeLists.ACCIDENT) : list(raw.form?.causes).length ? list(raw.form.causes) : d.form.causeLists.ACCIDENT,
      },
      lines: perLine((l) => line(raw.form?.lines?.[l], d.form.lines[l])),
      caseTypes,
      groups: (Array.isArray(raw.form?.groups) ? raw.form.groups : d.form.groups).filter((g: any) => typeof g?.id === 'string' && g.id).slice(0, 20).map((g: any): CompanyGroup => ({
        id: g.id.slice(0, 40), label: text(g.label, 'گروه بیمه‌گزاران', 120), companyIds: list(g.companyIds, 2000),
        lines: perLine((l) => typeList(g.lines?.[l], d.form.lines[l].claimTypes)),
        dependents: flag(g.dependents, false),
      })),
      dependents: flag(raw.form?.dependents, d.form.dependents),
      docsNote: typeof raw.form?.docsNote === 'string' ? raw.form.docsNote.trim().slice(0, 500) : d.form.docsNote,
    },
  };
}

/** The نوع پرونده a بیمه‌نامه line offers this company (`companyChain`: the company and its parents). */
export function typesFor(model: WorkflowModel, line: Line | null | undefined, companyChain: string[] = []): string[] {
  const group = model.form.groups.find((g) => g.companyIds.some((id) => companyChain.includes(id)));
  const of = (l: Line) => group?.lines[l] ?? model.form.lines[l].claimTypes;
  return line ? of(line) : [...new Set(LINES.flatMap(of))];
}

/** Does this company's filing form ask for «نوع بیمه‌شده»? Its group decides, else the insurer's setting. */
export function dependentsFor(model: WorkflowModel, companyChain: string[] = []): boolean {
  return model.form.groups.find((g) => g.companyIds.some((id) => companyChain.includes(id)))?.dependents ?? model.form.dependents;
}

export const caseTypeOf = (model: WorkflowModel, code: string | null | undefined): CaseType | null => model.form.caseTypes.find((t) => t.code === code) ?? null;

/** The rules of one case: the insurer's, with what its نوع پرونده changes on top. */
export function rulesOf(model: WorkflowModel, claimType?: string | null): CaseRules {
  const o = (claimType && model.byType[claimType]) || {};
  return {
    councilEnabled: o.councilEnabled ?? model.councilEnabled,
    requireLossNotice: o.requireLossNotice ?? model.requireLossNotice,
    requireOriginals: o.requireOriginals ?? model.requireOriginals,
  };
}

export const stageLabels = (model: WorkflowModel): Record<Stage, string> =>
  Object.fromEntries(ORDER.map((st) => [st, model.stages[st].label])) as Record<Stage, string>;

export function rank(s: Stage): number {
  return ORDER.indexOf(s);
}

/** The desks this claim passes through, bottom → top. A case already at شورای فنی stays on it if the desk is switched off. */
export function chainOf(claim: { brokerTenantId: string | null; currentStage?: Stage | string | null; claimType?: string | null }, model: WorkflowModel = DEFAULT_WORKFLOW_MODEL): Stage[] {
  const council = rulesOf(model, claim.claimType).councilEnabled;
  return ORDER.filter((s) => (s !== 'BROKER' || !!claim.brokerTenantId) && (s !== 'COUNCIL' || council || claim.currentStage === 'COUNCIL'));
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
    claimType?: string | null;
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
  physical: PhysicalState;
  model?: WorkflowModel;
  /** Why this login can't send the case on from the بیمه‌گزار desk (Model View). */
  submitBlocked?: string;
}

// ── Original (physical) documents ──
// They go بیمه‌گزار → شعبه and stay there, unless ستاد or شورای فنی ask for them; a request travels
// down one desk at a time (شورا → ستاد → شعبه) until it reaches whoever holds the originals.
export type PhysicalActionKey = 'PHYSICAL_SEND' | 'PHYSICAL_RELAY' | 'PHYSICAL_RECEIVE' | 'PHYSICAL_RETURN';

export interface PhysicalState {
  at: Stage | null; // null = still with the بیمه‌گزار
  open: { requesterStage: Stage; holderStage: Stage; status: 'REQUESTED' | 'SENT' } | null;
}

export interface PhysicalAction {
  key: PhysicalActionKey;
  label: string;
}

const PHYSICAL_CHAIN: Stage[] = ['POLICYHOLDER', 'BRANCH', 'HQ', 'COUNCIL'];

export function physicalBelow(s: Stage): Stage | null {
  const i = PHYSICAL_CHAIN.indexOf(s);
  return i > 0 ? PHYSICAL_CHAIN[i - 1] : null;
}

export function custodyOf(p: PhysicalState): Stage {
  return p.at ?? 'POLICYHOLDER';
}

/** Physical-document actions for the desk `me` sits at on this claim (independent of the claim's position). */
export function physicalActionsFor(me: Stage | null, p: PhysicalState, fa: Record<Stage, string> = STAGE_FA): PhysicalAction[] {
  if (!me) return [];
  const o = p.open;
  if (o?.status === 'REQUESTED' && o.holderStage === me) {
    if (custodyOf(p) === me) return [{ key: 'PHYSICAL_SEND', label: `ارسال اصل مدارک به ${fa[o.requesterStage]}` }];
    const next = physicalBelow(me);
    return next ? [{ key: 'PHYSICAL_RELAY', label: `ارسال درخواست اصل مدارک به ${fa[next]}` }] : [];
  }
  if (o?.status === 'SENT' && o.requesterStage === me) return [{ key: 'PHYSICAL_RECEIVE', label: 'تایید دریافت اصل مدارک' }];
  if (!o && (me === 'HQ' || me === 'COUNCIL') && p.at === me) return [{ key: 'PHYSICAL_RETURN', label: 'بازگرداندن اصل مدارک به شعبه' }];
  return [];
}

/**
 * The actions available to the desk that currently holds the claim. The caller must already have
 * checked that the actor sits at `claim.currentStage` (and at the right branch / org).
 */
export function actionsFor(ctx: ActionContext): WorkflowAction[] {
  const { claim, docs } = ctx;
  const model = ctx.model ?? DEFAULT_WORKFLOW_MODEL;
  const rules = rulesOf(model, claim.claimType);
  const fa = stageLabels(model);
  const s = claim.currentStage;
  if (!s || ['PAID', 'REJECTED'].includes(claim.status)) return [];
  const out: WorkflowAction[] = [];
  const dn = below(claim, s);
  const up = above(claim, s);
  const notApproved = !model.stages[s].reviewDocs ? undefined : docs.count === 0 ? 'مدرکی بارگذاری نشده است' : !docs.allApproved ? `ابتدا همهٔ مدارک را در مرحلهٔ ${fa[s]} تایید کنید` : undefined;

  if (s === 'POLICYHOLDER') {
    const disabled = ctx.submitBlocked ? ctx.submitBlocked : docs.count === 0
      ? 'ابتدا مدارک را بارگذاری کنید'
      : docs.rejectedAnywhere.length
        ? `مدارک ردشده را جایگزین کنید: ${docs.rejectedAnywhere.join('، ')}`
        : undefined;
    if (up) out.push({ key: 'SUBMIT', label: `ارسال به ${fa[up]}`, tone: 'primary', disabled });
    return out;
  }

  if (claim.flowDirection === 'DOWN') {
    if (claim.flowPurpose === 'PAYMENT') {
      if (s === 'BRANCH') out.push({ key: 'MARK_PAID', label: 'ثبت پرداخت به ذینفع', tone: 'primary' });
      else if (dn) out.push({ key: 'DOWN_FORWARD', label: `ارسال به ${fa[dn]} برای پرداخت`, tone: 'primary' });
      return out;
    }
    if (dn) out.push({ key: 'DOWN_FORWARD', label: `ارسال به ${fa[dn]}`, tone: 'primary' });
    if (ctx.isAdmin && dn && dn !== 'POLICYHOLDER') {
      out.push({ key: 'DOWN_DIRECT', label: 'ارسال مستقیم به بیمه‌گزار (اختیار مدیریت)', tone: 'ghost', adminOnly: true });
    }
    return out;
  }

  // ── UP: this desk is reviewing ──
  const ph = ctx.physical;
  const waitingOriginals = ph.open?.requesterStage === s ? 'در انتظار دریافت اصل مدارک' : undefined;
  if (s === 'BROKER' || s === 'BRANCH') {
    let disabled = notApproved;
    if (!disabled && s === 'BRANCH' && rules.requireLossNotice && !claim.lossNoticeNumber) disabled = 'ابتدا اعلام خسارت را ثبت کنید';
    if (!disabled && s === 'BRANCH' && !ph.at && (rules.requireOriginals || waitingOriginals)) disabled = waitingOriginals ?? 'ابتدا اصل مدارک را از بیمه‌گزار دریافت کنید';
    if (!disabled && s === 'BROKER' && !ctx.branches.length) disabled = 'بیمه‌گر هیچ شعبه‌ای تعریف نکرده است';
    out.push({
      key: 'FORWARD',
      label: `ارسال به ${fa[up!]}`,
      tone: 'primary',
      disabled,
      ...(s === 'BROKER' ? { branchOptions: ctx.branches, selectedBranchId: claim.handlingBranchId } : {}),
    });
  } else if (s === 'HQ') {
    const council = { key: 'REFER_COUNCIL' as const, label: 'ارجاع به شورای فنی', tone: 'primary' as const, disabled: notApproved ?? waitingOriginals };
    if (claim.returnTargetStage === 'COUNCIL') {
      // شورای فنی returned it — after the fix it must go back to the council, not be paid here.
      out.push({ ...council, label: 'ارسال به شورای فنی' });
    } else {
      const payable = Number((claim.finalizedAmount ?? claim.claimedAmount).toString());
      const ceiling = ctx.hqCeiling != null ? Number(ctx.hqCeiling.toString()) : null;
      let disabled = notApproved ?? waitingOriginals;
      if (!disabled && claim.finalizedAmount == null) disabled = 'ابتدا مبلغ خسارت قطعی را ثبت کنید';
      if (!disabled && rules.councilEnabled && ceiling != null && payable > ceiling) disabled = 'مبلغ بیش از سقف اختیار مدیریت ستاد است؛ پرونده را به شورای فنی ارجاع دهید';
      out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت — ارسال به شعبه', tone: 'primary', disabled });
      if (rules.councilEnabled) out.push(council);
    }
  } else if (s === 'COUNCIL') {
    let disabled = notApproved ?? waitingOriginals;
    if (!disabled && claim.finalizedAmount == null) disabled = 'ابتدا مبلغ خسارت قطعی را ثبت کنید';
    out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت — ارسال به مدیریت ستاد', tone: 'primary', disabled });
  }

  // Ask for the originals: شعبه from بیمه‌گزار (after approving the scans), ستاد from شعبه, شورا via ستاد.
  if (s !== 'BROKER' && !ph.open && custodyOf(ph) !== s) {
    const label = s === 'BRANCH' ? 'درخواست اصل مدارک از بیمه‌گزار' : s === 'HQ' ? 'درخواست اصل مدارک از شعبه' : 'درخواست اصل مدارک (از طریق مدیریت ستاد)';
    out.push({ key: 'REQUEST_PHYSICAL', label, tone: 'ghost', disabled: s === 'BRANCH' ? notApproved : undefined });
  }

  if (dn) {
    // ستاد (سرپرستی) sends a case back to شعبه as «برگشت از سرپرستی به شعبه».
    const back = s === 'HQ' && dn === 'BRANCH' ? 'برگشت از سرپرستی به شعبه' : `ارسال به ${fa[dn]} (عودت برای رفع نقص)`;
    out.push({ key: 'RETURN', label: back, tone: 'warning', needsDeficiencies: true });
    if (ctx.isAdmin && dn !== 'POLICYHOLDER') {
      // Skips every desk below — the panel asks the operator to confirm (yes / no) before it goes.
      const from = s === 'HQ' ? 'سرپرستی' : fa[s] ?? '';
      out.push({ key: 'RETURN_DIRECT', label: `برگشت از ${from} به بیمه‌گزار`, tone: 'ghost', adminOnly: true, needsDeficiencies: true, confirm: true });
    }
  }
  if (s !== 'BROKER') out.push({ key: 'REJECT_FINAL', label: 'رد نهایی پرونده', tone: 'danger', needsNote: true });
  return out;
}
