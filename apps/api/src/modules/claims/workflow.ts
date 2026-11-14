import { allKinds, KIND_CODE } from '../../common/kinds';
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
  | 'FIX_HERE' // a desk a return reached fixes it itself and reviews the case again (no further down)
  | 'MARK_PAID' // شعبه records the payout to the beneficiary
  | 'REJECT_FINAL' // substantive rejection (not covered etc.)
  | 'REQUEST_PHYSICAL' // ask for the original documents (side track — the claim stays put)
  | 'APPROVE_AMOUNT' // ستاد approves the amount شعبه proposed (the case stays at ستاد)
  | 'REJECT_AMOUNT'; // ستاد rejects it, with the reason, back to شعبه

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
/** causeLabel: what panel 1 calls «علت» in this kind («علت فوت» in عمر, «علت خسارت» elsewhere). */
export interface LineForm { insuredLabel: string; claimTypes: string[]; causeLabel: string }
/**
 * نوع بیمه‌شده: the main insured (اصلی) or one of their dependents (فرعی). On a dependent's case the
 * deceased* fields are that person and mainInsured* name the main insured.
 */
export const INSURED_RELATIONS = ['MAIN', 'SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'OTHER'] as const;
export type InsuredRelation = (typeof INSURED_RELATIONS)[number];
export const DEPENDENT_RELATIONS: InsuredRelation[] = ['SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'OTHER'];
export const RELATION_FA: Record<InsuredRelation, string> = { MAIN: 'اصلی', SPOUSE: 'همسر', CHILD: 'فرزند', FATHER: 'پدر', MOTHER: 'مادر', OTHER: 'سایر' };

/**
 * نوع بیمه‌نامه: a code of Super Admin's catalog (common/kinds.ts). A kind starts with no نوع پرونده at an
 * insurer: filing in it opens once Super Admin ticks its types in Model View (عمر and حوادث come preset).
 */
export type Line = string;
export { asLine } from '../../common/kinds';
const EMPTY_LINE: LineForm = { insuredLabel: 'نام بیمه‌شده', claimTypes: [], causeLabel: 'علت خسارت' };
/** A kind's form settings at an insurer (a kind added after the model was saved has none yet). */
export function lineForm(model: WorkflowModel, line: Line): LineForm { return model.form.lines[line] ?? EMPTY_LINE; }
/** Every kind the model should hold settings for: the catalog's, plus any it already has. */
const perLine = <T>(stored: unknown, f: (l: Line) => T) => {
  const keys = new Set([...allKinds().map((k) => k.code), ...(stored && typeof stored === 'object' ? Object.keys(stored).filter((k) => KIND_CODE.test(k)) : [])]);
  return Object.fromEntries([...keys].map((l) => [l, f(l)])) as Record<Line, T>;
};
/**
 * One نوع پرونده. causes: its own «علت» list (empty = the list of its causeGroup); death: the case speaks
 * of a متوفی and takes the ذینفع step.
 */
export interface CaseType { code: string; label: string; causeGroup: 'DEATH' | 'ACCIDENT'; death: boolean; causes: string[]; detail?: CaseDetail | null }
/**
 * A second, required choice some causes ask for (e.g. «نوع حادثه» after «فوت در اثر حادثه…»): `causes` are the
 * causes that ask it (empty = every cause of the type). Documents can be required only for some options.
 */
export interface CaseDetail { label: string; options: string[]; causes: string[] }
/** بیمه‌گزار companies that file different نوع پرونده than the insurer's usual ones (a ticked company covers its subsidiaries). */
export interface CompanyGroup { id: string; label: string; companyIds: string[]; lines: Record<Line, string[]>; dependents: boolean }
/**
 * Where a case the insurer's own staff enter from panel 1 starts: on the کارگزاری's desk (its initial
 * assessment first, as if the brokerage had filed it), straight at the insurer's شعبه, or chosen each time.
 */
// CHANNEL: by the case itself — one with a کارگزاری goes to its desk, the insurer's own (direct) sale to شعبه.
export type EntryWay = 'BROKER' | 'BRANCH' | 'ASK' | 'CHANNEL';
export const ENTRY_WAYS: EntryWay[] = ['BROKER', 'BRANCH', 'ASK', 'CHANNEL'];
/**
 * «روند سیناد»: شعبه works from a Sinad-style kartable — cases are allocated to one evaluator in batches,
 * evaluated in a full-screen window (risk check, ارزیابی / عودت tabs, پزشک معتمد). Only the screens and
 * the allocation change; the chain's rules stay those of the model.
 */
export interface ReturnGroup { label: string; items: string[] }
export interface SinadSettings { enabled: boolean; batchSize: number; returnGroups: ReturnGroup[] }
export const DEFAULT_RETURN_GROUPS: ReturnGroup[] = [
  { label: 'نقص مدارک', items: ['گواهی فوت ارائه نشده است', 'گواهی انحصار وراثت ارائه نشده است', 'تصویر شناسنامه و کارت ملی بیمه‌شده ارائه نشده است', 'گزارش پزشکی قانونی ارائه نشده است', 'تصویر مدارک خوانا نیست'] },
  { label: 'نواقص موردی', items: ['مدارک مهر برابر اصل ندارد', 'تاریخ‌های مدارک با هم مطابقت ندارد', 'نام بیمه‌شده با بیمه‌نامه مطابقت ندارد', 'شماره حساب (شبا) ذینفع ارائه نشده است'] },
  { label: 'غیر قابل پرداخت', items: ['حادثه خارج از مدت اعتبار بیمه‌نامه رخ داده است', 'علت خسارت از استثنائات بیمه‌نامه است', 'بیمه‌شده در فهرست بیمه‌شدگان نیست'] },
  { label: 'دعوت به معاینه', items: ['نیاز به معاینهٔ بیمه‌شده توسط پزشک معتمد', 'تعیین درصد نقص عضو توسط پزشک معتمد'] },
  { label: 'هزینه‌های نامرتبط', items: ['هزینهٔ پزشکی با حادثه مرتبط نیست', 'هزینه مربوط به بیمه‌شدهٔ دیگری است'] },
];
export interface WorkflowModel extends CaseRules {
  sinad: SinadSettings;
  lossNoticeAsksNumber: boolean; // «اعلام خسارت»: شعبه types its number and date (false: one «ثبت اعلام خسارت» click)
  stages: Record<Stage, { label: string; reviewDocs: boolean }>; // reviewDocs: must this desk ✓ every document before sending on?
  byType: Record<string, Partial<CaseRules>>; // نوع پرونده → what differs from the rules above
  panels: { COMPANY: PanelRights; REPRESENTATIVE: PanelRights };
  // پنل بیمه‌شده: what an invited بیمه‌شده uploads; how long an invitation lasts. selfFiling: «اعلام خسارت» in panel 3
  // (a بیمه‌شده files their own case, or a deceased relative's) — only with فن‌آوران on, for کد ملی registered there.
  insured: { enabled: boolean; docCodes: string[]; linkDays: number; selfFiling: boolean };
  entry: { way: EntryWay }; // the insurer's own panel-1 filings (see EntryWay)
  form: {
    eventLabel: string;
    birthDate: FieldMode;
    cause: FieldMode;
    causeLists: { DEATH: string[]; ACCIDENT: string[] }; // ticks above the typed cause, by causeGroup
    causeNotes: Record<string, string>; // a cause's ready text («متن»): picking it on panel 1 adds this to «شرح»
    lines: Record<Line, LineForm>;
    caseTypes: CaseType[];
    groups: CompanyGroup[];
    dependents: boolean; // «نوع بیمه‌شده» (اصلی / همسر / فرزند / پدر / مادر / سایر) on the filing form, for companies outside a group
    docsNote: string; // shown above the document uploads
  };
}
const LIFE_TYPES = ['DEATH_ILLNESS', 'DISABILITY_ILLNESS'];
const ACCIDENT_TYPES = ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT', 'MEDICAL_ACCIDENT', 'DAILY_GENERAL', 'DAILY_HOSPITAL'];
/** «نوع حادثه» after a «فوت در اثر حادثه…» cause of «فوت به هر علت». */
const ACCIDENT_DETAIL: CaseDetail = {
  label: 'نوع حادثه',
  options: ['حادثه در محل کار', 'فوت به علت حادثه', 'حادثه تصادف', 'نزاع و درگیری'],
  causes: ['فوت در اثر حادثه-ذینفع "بیمه گزار"', 'فوت در اثر حادثه با برگه ذینفع', 'فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"', 'فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"'],
};
export const DEFAULT_CASE_TYPES: CaseType[] = ([
  { code: 'DEATH_ILLNESS', label: 'فوت به هر علت', causeGroup: 'DEATH', death: true, causes: ['بیماری', 'سرطان', 'سکته قلبی بدون برگه ذینفع', 'فوت-عدم تعیین سهم ذینفعها و پرداخت در وجه وراث', 'انفجار', 'سکته قلبی-پرداخت در وجه وکیل یا وراث', 'سکته قلبی-پرداخت در وجه بیمه گزار', 'سکته مغزی-پرداخت در وجه بیمه گزار', 'فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"', 'فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"', 'سکته قلبی با برگه ذینفع', 'سکته مغزی با برگه ذینفع', 'فوت در اثر حادثه با برگه ذینفع', 'بیماری کرونا', 'بیماری های تنفسی', 'فوت در اثر حادثه-ذینفع "بیمه گزار"', 'جنگ'], detail: ACCIDENT_DETAIL },
  { code: 'DISABILITY_ILLNESS', label: 'از کار افتادگی دائم و کامل ناشی از بیماری', causeGroup: 'DEATH', death: false, causes: ['ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی تأمین اجتماعی و تائید بیمه‌گر', 'ازکارافتادگی کلی ناشی از بیماری با رأی کمیسیون پزشکی بیمه گزار'] },
  // «جنگ» is a cause of عمر only (فوت به هر علت), never of a حوادث type.
  { code: 'DEATH_ACCIDENT', label: 'فوت بر اثر حادثه', causeGroup: 'ACCIDENT', death: true, causes: ['حادثه ناشی از کار', 'حادثه غیر ناشی از کار (تصادف)', 'زلزله (با فرم تعیین ذینفع)', 'زلزله (بدون فرم تعیین ذینفع)', 'حادثه (با هزینه پزشکی)', 'حادثه (بدون هزینه پزشکی)'] },
  { code: 'DISABILITY_ACCIDENT', label: 'نقص عضو و از کار افتادگی بر اثر حادثه', causeGroup: 'ACCIDENT', death: false, causes: ['حادثه ناشی از کار', 'حادثه غیر ناشی از کار (تصادف)', 'زلزله (با فرم تعیین ذینفع)', 'زلزله (بدون فرم تعیین ذینفع)', 'حادثه (با هزینه پزشکی)', 'حادثه (بدون هزینه پزشکی)'] },
  { code: 'MEDICAL_ACCIDENT', label: 'جبران هزینه‌های پزشکی ناشی از حادثه', causeGroup: 'ACCIDENT', death: false, causes: ['حادثه ناشی از کار', 'حادثه غیر ناشی از کار (تصادف)', 'زلزله (با فرم تعیین ذینفع)', 'زلزله (بدون فرم تعیین ذینفع)', 'حادثه (با هزینه پزشکی)', 'حادثه (بدون هزینه پزشکی)'] },
  // غرامت روزانه: no list of their own yet (the حادثه list applies)
  { code: 'DAILY_GENERAL', label: 'غرامت روزانه عمومی', causeGroup: 'ACCIDENT', death: false, causes: [] },
  { code: 'DAILY_HOSPITAL', label: 'غرامت روزانه بیمارستانی', causeGroup: 'ACCIDENT', death: false, causes: [] },
] as CaseType[]).map((t) => ({ ...t, detail: t.detail ?? null }));
/** The «علت» options of one نوع پرونده: its own list, else its causeGroup's. */
export function causesOf(model: WorkflowModel, code: string | null | undefined): string[] {
  const t = model.form.caseTypes.find((x) => x.code === code);
  return groupCauses(t?.causes.length ? t.causes : model.form.causeLists[t?.causeGroup ?? 'ACCIDENT']);
}

/** The «علت» lists of a filing form (every panel 1), with causes that start alike together. */
export function formCauses(model: WorkflowModel) {
  return {
    causeLists: { DEATH: groupCauses(model.form.causeLists.DEATH), ACCIDENT: groupCauses(model.form.causeLists.ACCIDENT) },
    caseTypes: model.form.caseTypes.map((t) => ({ ...t, causes: groupCauses(t.causes) })),
  };
}

/**
 * Causes that start alike sit together on the forms (every «سکته…», then every «فوت…»): ordered by where their
 * first word, then their first two words, first appear in the list; otherwise the list's own order is kept.
 */
export function groupCauses(list: string[]): string[] {
  const words = (s: string) => s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').split(/[\s\-‌]+/).filter(Boolean);
  const first = new Map<string, number>();
  const firstTwo = new Map<string, number>();
  list.forEach((c, i) => {
    const w = words(c);
    if (!first.has(w[0] ?? '')) first.set(w[0] ?? '', i);
    const k2 = w.slice(0, 2).join(' ');
    if (!firstTwo.has(k2)) firstTwo.set(k2, i);
  });
  return list.map((c, i) => ({ c, i, w: words(c) }))
    .sort((a, b) => (first.get(a.w[0] ?? '')! - first.get(b.w[0] ?? '')!) || (firstTwo.get(a.w.slice(0, 2).join(' '))! - firstTwo.get(b.w.slice(0, 2).join(' '))!) || a.i - b.i)
    .map((x) => x.c);
}
export const DEFAULT_WORKFLOW_MODEL: WorkflowModel = {
  councilEnabled: true,
  requireLossNotice: true,
  requireOriginals: true,
  lossNoticeAsksNumber: true,
  sinad: { enabled: false, batchSize: 10, returnGroups: DEFAULT_RETURN_GROUPS },
  stages: {
    POLICYHOLDER: { label: STAGE_FA.POLICYHOLDER, reviewDocs: false },
    BROKER: { label: STAGE_FA.BROKER, reviewDocs: true },
    BRANCH: { label: STAGE_FA.BRANCH, reviewDocs: true },
    HQ: { label: STAGE_FA.HQ, reviewDocs: true },
    COUNCIL: { label: STAGE_FA.COUNCIL, reviewDocs: true },
  },
  byType: {},
  panels: { COMPANY: { upload: true, submit: true }, REPRESENTATIVE: { upload: true, submit: true } },
  insured: { enabled: false, docCodes: [], linkDays: 7, selfFiling: false },
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
      'سکته قلبی-پرداخت در وجه بیمه گزار',
      'سکته مغزی-پرداخت در وجه بیمه گزار',
      'فوت در اثر حادثه-پرداخت در وجه "وکیل یا وراث"',
      'فوت در اثر حادثه-پرداخت در وجه "وراث قانونی"',
      'سکته قلبی با برگه ذینفع',
      'سکته مغزی با برگه ذینفع',
      'فوت در اثر حادثه با برگه ذینفع',
      'بیماری کرونا',
      'بیماری های تنفسی',
      'فوت در اثر حادثه-ذینفع "بیمه گزار"',
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
      LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: LIFE_TYPES, causeLabel: 'علت فوت' },
      ACCIDENT: { insuredLabel: 'نام بیمه‌شده (مصدوم/متوفی)', claimTypes: ACCIDENT_TYPES, causeLabel: 'علت خسارت' },
      LIABILITY: { insuredLabel: 'نام زیان‌دیده', claimTypes: [], causeLabel: 'علت خسارت' },
      CREDIT_LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: [], causeLabel: 'علت خسارت' },
      ACCIDENT_INDIVIDUAL: { insuredLabel: 'نام بیمه‌شده (مصدوم/متوفی)', claimTypes: [], causeLabel: 'علت خسارت' },
      SAVINGS_LIFE: { insuredLabel: 'نام بیمه‌شده (متوفی/از کار افتاده)', claimTypes: [], causeLabel: 'علت خسارت' },
    },
    caseTypes: DEFAULT_CASE_TYPES,
    groups: [{ id: 'copper', label: 'شرکت‌های زیرمجموعه صنایع ملی مس ایران', companyIds: [], lines: { LIFE: LIFE_TYPES, ACCIDENT: ['DEATH_ACCIDENT', 'DISABILITY_ACCIDENT'], LIABILITY: [], CREDIT_LIFE: [], ACCIDENT_INDIVIDUAL: [], SAVINGS_LIFE: [] }, dependents: false }],
    dependents: true,
    causeNotes: {},
    docsNote: 'تصاویر مدارک موجود در پرونده باید خوانا و ممهور به مهر برابر اصل توسط مراجع یا مقامات ذی‌صلاح قانونی باشد.',
  },
};

/** «متن» of each علت خسارت: cause text → its note (strings only; at most 200, 1000 characters each). */
function notesOf(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    if (typeof n === 'string' && n.trim() && k.trim()) out[k.trim().slice(0, 120)] = n.trim().slice(0, 1000);
  }
  return out;
}

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
  const caseDetail = (d: any): CaseDetail | null => {
    const options = list(d?.options, 20);
    return options.length ? { label: text(d?.label, 'نوع حادثه', 60), options, causes: list(d?.causes) } : null;
  };
  const caseType = (r: any, def?: CaseType): CaseType => ({
    code: def?.code ?? r.code, label: text(r?.label, def?.label ?? r.code, 120),
    causeGroup: r?.causeGroup === 'DEATH' || r?.causeGroup === 'ACCIDENT' ? r.causeGroup : def?.causeGroup ?? 'ACCIDENT',
    death: flag(r?.death, def?.death ?? false),
    causes: Array.isArray(r?.causes) ? list(r.causes) : def?.causes ?? [],
    detail: r && 'detail' in r ? caseDetail(r.detail) : def?.detail ?? null,
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
  const line = (r: any, def: LineForm): LineForm => ({ insuredLabel: text(r?.insuredLabel, def.insuredLabel), claimTypes: typeList(r?.claimTypes, def.claimTypes), causeLabel: text(r?.causeLabel, def.causeLabel ?? EMPTY_LINE.causeLabel, 40) });
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
  const batch = Number(raw.sinad?.batchSize);
  const groups: ReturnGroup[] = Array.isArray(raw.sinad?.returnGroups)
    ? raw.sinad.returnGroups.filter((g: any) => typeof g?.label === 'string' && g.label.trim()).slice(0, 20).map((g: any) => ({ label: g.label.trim().slice(0, 80), items: list(g.items, 60) }))
    : d.sinad.returnGroups;
  return {
    sinad: { enabled: flag(raw.sinad?.enabled, false), batchSize: batch >= 1 && batch <= 100 ? Math.round(batch) : d.sinad.batchSize, returnGroups: groups },
    councilEnabled: flag(raw.councilEnabled, d.councilEnabled),
    requireLossNotice: flag(raw.requireLossNotice, d.requireLossNotice),
    requireOriginals: flag(raw.requireOriginals, d.requireOriginals),
    lossNoticeAsksNumber: flag(raw.lossNoticeAsksNumber, d.lossNoticeAsksNumber),
    stages,
    byType,
    panels: { COMPANY: rights(raw.panels?.COMPANY, d.panels.COMPANY), REPRESENTATIVE: rights(raw.panels?.REPRESENTATIVE, d.panels.REPRESENTATIVE) },
    insured: { enabled: flag(raw.insured?.enabled, false), docCodes: list(raw.insured?.docCodes), linkDays: days >= 1 && days <= 60 ? Math.round(days) : d.insured.linkDays, selfFiling: flag(raw.insured?.selfFiling, false) },
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
      causeNotes: notesOf(raw.form?.causeNotes),
      lines: perLine(raw.form?.lines, (l) => line(raw.form?.lines?.[l], lineForm(d, l))),
      caseTypes,
      groups: (Array.isArray(raw.form?.groups) ? raw.form.groups : d.form.groups).filter((g: any) => typeof g?.id === 'string' && g.id).slice(0, 20).map((g: any): CompanyGroup => ({
        id: g.id.slice(0, 40), label: text(g.label, 'گروه بیمه‌گزاران', 120), companyIds: list(g.companyIds, 2000),
        lines: perLine(g.lines, (l) => typeList(g.lines?.[l], lineForm(d, l).claimTypes)),
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
  const of = (l: Line) => group?.lines[l] ?? lineForm(model, l).claimTypes;
  return line ? of(line) : [...new Set(Object.keys(model.form.lines).flatMap(of))];
}

/** Does this company's filing form ask for «نوع بیمه‌شده»? Its group decides, else the insurer's setting. */
export function dependentsFor(model: WorkflowModel, companyChain: string[] = []): boolean {
  return model.form.groups.find((g) => g.companyIds.some((id) => companyChain.includes(id)))?.dependents ?? model.form.dependents;
}

/** «علت» texts compared loosely: spaces, ZWNJ, kashida, quotes, ي/ك and «گذار»/«گزار» don't matter. */
export const normCause = (s: string | null | undefined) =>
  (s ?? '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/گذار/g, 'گزار').replace(/[\s\u200c\u0640"'«»]+/g, '');
const sameCause = (list: string[], v: string | null | undefined) => { const c = normCause(v); return !!c && list.some((x) => normCause(x) === c); };

/** The second choice the picked cause asks for (null = none). */
export function detailFor(t: CaseType | null | undefined, cause: string | null | undefined): CaseDetail | null {
  const d = t?.detail;
  if (!d?.options.length) return null;
  return !d.causes.length || sameCause(d.causes, cause) ? d : null;
}

type DocRule = { appliesToTypes: string[]; requiredTypes: string[]; causes?: string[] | null; requiredDetails?: string[] | null };
type DocClaim = { claimType: string; causeOfDeath?: string | null; causeDetail?: string | null };
/** Is the document listed for this case: its نوع پرونده, and its «علت» when the document names some. */
export const docApplies = (r: DocRule, c: DocClaim) => r.appliesToTypes.includes(c.claimType) && (!r.causes?.length || sameCause(r.causes, c.causeOfDeath));
/** Must it be uploaded before sending: required for the type, and for the «نوع حادثه» when the document names some. */
export const docRequired = (r: DocRule, c: DocClaim) => r.requiredTypes.includes(c.claimType) && (!r.requiredDetails?.length || sameCause(r.requiredDetails, c.causeDetail));

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

/**
 * An insurer's panel-1 case waits at the بیمه‌گزار desk until its «ثبت نهایی»; it then goes (the first time
 * only) to the desk Model View set when it was filed — which may skip the کارگزاری.
 */
export function submitTarget(claim: { brokerTenantId: string | null; currentStage?: Stage | string | null; submitTo?: string | null }): Stage | null {
  const t = claim.submitTo as Stage | null | undefined;
  return claim.currentStage === 'POLICYHOLDER' && t && t !== 'POLICYHOLDER' && chainOf(claim).includes(t) ? t : null;
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
  deficiencyMissing?: string[]; // documents an open نقص asks for that have not been uploaded since
  insurerMissing?: string[]; // documents only the insurer provides (فرم تعیین وضعیت پوشش…) that شعبه must still upload
}

/**
 * Documents only the insurer can provide — «فرم تکمیل شده تعیین وضعیت پوشش بیمه شده توسط واحد صدور» (and its
 * «بررسی دوره انتظار»): required only of شعبه's evaluator before sending the case on; optional everywhere else.
 */
export const insurerOnlyDoc = (code: string) => /coverage_form|waiting_period/.test(code);

export interface ActionContext {
  claim: {
    brokerTenantId: string | null;
    claimType?: string | null;
    status: string;
    currentStage: Stage | null;
    flowDirection: Direction | null;
    flowPurpose: Purpose | null;
    returnTargetStage: Stage | null;
    submitTo?: string | null; // see submitTarget
    lossNoticeNumber: string | null;
    lossNoticeDate?: Date | null; // set when اعلام خسارت was recorded (with or without a number)
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
  /** Why the گیرندگان خسارت aren't ready for a payment yet (name, کد ملی, شبا, shares); undefined = ready. */
  payeesMissing?: string;
  /** Has ستاد approved the amount شعبه proposed? (undefined = not asked, as before) */
  amountApproved?: boolean;
  /**
   * مجوز سرپرستی (حدود اختیار) of this case for the caller: given by ستاد with the payment order, to the شعبه
   * operator who has the case, up to the approved amount; used up by the payment. Null = none for them.
   */
  authority?: { ceiling: number } | null;
}

/** The amount a payment pays: the approved (قطعی) amount, else the estimate. */
export const payAmount = (claim: { finalizedAmount: { toString(): string } | null; claimedAmount: { toString(): string } }) =>
  Number((claim.finalizedAmount ?? claim.claimedAmount).toString());

// ── Original (physical) documents ──
// They go to شعبه and stay there, unless ستاد or شورای فنی ask for them; a request travels down one desk
// at a time (شورا → ستاد → شعبه) until it reaches whoever holds the originals. The insurer never reaches
// past a کارگزاری: on a broker's case شعبه asks the کارگزاری (who gets them from its بیمه‌گزار), and on
// a direct sale the بیمه‌گزار desk.
export type PhysicalActionKey = 'PHYSICAL_SEND' | 'PHYSICAL_RELAY' | 'PHYSICAL_RECEIVE' | 'PHYSICAL_RETURN';

export interface PhysicalState {
  at: Stage | null; // null = not yet with the insurer (with `base`)
  base?: Stage; // where the originals start: BROKER on a broker's case, else POLICYHOLDER
  open: { requesterStage: Stage; holderStage: Stage; status: 'REQUESTED' | 'SENT' } | null;
}

export interface PhysicalAction {
  key: PhysicalActionKey;
  label: string;
}

export function physicalBelow(s: Stage, base: Stage = 'POLICYHOLDER'): Stage | null {
  const chain: Stage[] = [base, 'BRANCH', 'HQ', 'COUNCIL'];
  const i = chain.indexOf(s);
  return i > 0 ? chain[i - 1] : null;
}

export function custodyOf(p: PhysicalState): Stage {
  return p.at ?? p.base ?? 'POLICYHOLDER';
}

/**
 * How far down a manager's «مستقیم» hand-off may go from desk `s`: the بیمه‌گزار — but from the insurer's
 * desks never past the کارگزاری of a broker's case (the insurer deals only with its کارگزاری).
 */
export function directTarget(claim: { brokerTenantId: string | null }, s: Stage): Stage {
  return claim.brokerTenantId && s !== 'BROKER' && s !== 'POLICYHOLDER' ? 'BROKER' : 'POLICYHOLDER';
}

/** Physical-document actions for the desk `me` sits at on this claim (independent of the claim's position). */
export function physicalActionsFor(me: Stage | null, p: PhysicalState, fa: Record<Stage, string> = STAGE_FA): PhysicalAction[] {
  if (!me) return [];
  const o = p.open;
  if (o?.status === 'REQUESTED' && o.holderStage === me) {
    // (the بیمه‌گزار desk can always send what was asked of it — requests made before کارگزاری sat in the chain)
    if (custodyOf(p) === me || me === 'POLICYHOLDER') return [{ key: 'PHYSICAL_SEND', label: `ارسال اصل مدارک به ${fa[o.requesterStage]}` }];
    const next = physicalBelow(me, p.base);
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
  const up = (s === 'POLICYHOLDER' ? submitTarget(claim) : null) ?? above(claim, s);
  const notApproved = !model.stages[s].reviewDocs ? undefined : docs.count === 0 ? 'مدرکی بارگذاری نشده است' : !docs.allApproved ? `ابتدا همهٔ مدارک را در مرحلهٔ ${fa[s]} تایید کنید` : undefined;

  if (s === 'POLICYHOLDER') {
    const disabled = ctx.submitBlocked ? ctx.submitBlocked : docs.count === 0
      ? 'ابتدا مدارک را بارگذاری کنید'
      : docs.rejectedAnywhere.length
        ? `مدارک ردشده را جایگزین کنید: ${docs.rejectedAnywhere.join('، ')}`
        : docs.deficiencyMissing?.length
          ? `مدارک خواسته‌شده را بارگذاری کنید: ${docs.deficiencyMissing.join('، ')}`
          : undefined;
    if (up) out.push({ key: 'SUBMIT', label: `ارسال به ${fa[up]}`, tone: 'primary', disabled });
    return out;
  }

  if (claim.flowDirection === 'DOWN') {
    if (claim.flowPurpose === 'PAYMENT') {
      if (s === 'BRANCH') {
        // No payment without the مجوز سرپرستی ستاد gave this operator for this case, up to its ceiling.
        const auth = ctx.authority;
        const disabled = ctx.payeesMissing
          ?? (ctx.authority === undefined ? undefined
            : !auth ? 'مجوز سرپرستی پرداخت این پرونده برای شما صادر نشده است'
            : payAmount(claim) > auth.ceiling ? `مبلغ پرداخت بیش از سقف مجوز سرپرستی (${auth.ceiling.toLocaleString('fa-IR')} ریال) است` : undefined);
        out.push({ key: 'MARK_PAID', label: 'ثبت پرداخت به ذینفع', tone: 'primary', disabled, confirm: true });
      } else if (dn) {
        // شورای فنی's order reaches ستاد: ستاد hands it to شعبه with the مجوز سرپرستی.
        out.push({ key: 'DOWN_FORWARD', label: s === 'HQ' ? `صدور مجوز سرپرستی و ارسال به ${fa[dn]} برای پرداخت` : `ارسال به ${fa[dn]} برای پرداخت`, tone: 'primary', disabled: s === 'HQ' ? ctx.payeesMissing : undefined });
      }
      return out;
    }
    // The desk a return reached may fix it itself (upload / replace what was asked, set the amount…) and
    // review the case again, or hand it on down to whoever can fix it.
    const fix = docs.rejectedAnywhere.length
      ? `ابتدا مدارک ردشده را جایگزین کنید: ${docs.rejectedAnywhere.join('، ')}`
      : docs.deficiencyMissing?.length ? `ابتدا مدارک خواسته‌شده را بارگذاری کنید: ${docs.deficiencyMissing.join('، ')}` : undefined;
    out.push({ key: 'FIX_HERE', label: `رفع نقص در ${fa[s]} و ادامهٔ بررسی`, tone: 'primary', disabled: fix });
    if (dn) out.push({ key: 'DOWN_FORWARD', label: `ارسال به ${fa[dn]} برای رفع نقص`, tone: 'warning' });
    const bottom = directTarget(claim, s);
    if (ctx.isAdmin && dn && dn !== 'POLICYHOLDER' && dn !== bottom) {
      out.push({ key: 'DOWN_DIRECT', label: `ارسال مستقیم به ${fa[bottom]} (اختیار مدیریت)`, tone: 'ghost', adminOnly: true });
    }
    return out;
  }

  // ── UP: this desk is reviewing ──
  const ph = ctx.physical;
  const phBase: Stage = ph.base ?? 'POLICYHOLDER';
  const waitingOriginals = ph.open?.requesterStage === s ? 'در انتظار دریافت اصل مدارک' : undefined;
  if (s === 'BROKER' || s === 'BRANCH') {
    let disabled = notApproved;
    // «اعلام خسارت» is a document the بیمه‌گزار uploads for now (no شعبه button): it no longer blocks.
    if (!disabled && s === 'BRANCH' && docs.insurerMissing?.length) disabled = `ابتدا این مدارک را (که فقط بیمه‌گر صادر می‌کند) بارگذاری کنید: ${docs.insurerMissing.join('، ')}`;
    if (!disabled && s === 'BRANCH' && claim.finalizedAmount == null) disabled = 'ابتدا مبلغ خسارت قطعی را ثبت کنید';
    if (!disabled && s === 'BRANCH' && !ph.at && (rules.requireOriginals || waitingOriginals)) disabled = waitingOriginals ?? `ابتدا اصل مدارک را از ${fa[phBase]} دریافت کنید`;
    if (!disabled && s === 'BROKER' && !ctx.branches.length) disabled = 'بیمه‌گر هیچ شعبه‌ای تعریف نکرده است';
    out.push({
      key: 'FORWARD',
      label: `ارسال به ${fa[up!]}`,
      tone: 'primary',
      disabled,
      ...(s === 'BROKER' ? { branchOptions: ctx.branches, selectedBranchId: claim.handlingBranchId } : {}),
    });
  } else if (s === 'HQ') {
    const noAmount = 'مبلغ خسارت قطعی را شعبه ثبت نکرده است؛ پرونده را برای ثبت آن به شعبه برگردانید';
    const council = { key: 'REFER_COUNCIL' as const, label: 'ارجاع به شورای فنی', tone: 'primary' as const, disabled: notApproved ?? waitingOriginals };
    if (claim.returnTargetStage === 'COUNCIL') {
      // شورای فنی returned it — after the fix it must go back to the council, not be paid here.
      out.push({ ...council, label: 'ارسال به شورای فنی' });
    } else {
      const payable = Number((claim.finalizedAmount ?? claim.claimedAmount).toString());
      const ceiling = ctx.hqCeiling != null ? Number(ctx.hqCeiling.toString()) : null;
      let disabled = notApproved ?? waitingOriginals;
      if (!disabled && claim.finalizedAmount == null) disabled = noAmount;
      if (!disabled && rules.councilEnabled && ceiling != null && payable > ceiling) disabled = 'مبلغ بیش از سقف اختیار مدیریت ستاد است؛ پرونده را به شورای فنی ارجاع دهید';
      // The amount شعبه proposed: ستاد approves it, or rejects it back to شعبه with the reason.
      if (claim.finalizedAmount != null && ctx.amountApproved === false) {
        out.push({ key: 'APPROVE_AMOUNT', label: 'تایید مبلغ خسارت پیشنهادی شعبه', tone: 'primary', confirm: true });
        out.push({ key: 'REJECT_AMOUNT', label: 'رد مبلغ و عودت به شعبه', tone: 'danger', needsNote: true });
        if (!disabled) disabled = 'ابتدا مبلغ خسارت پیشنهادی شعبه را تایید کنید';
      }
      if (!disabled) disabled = ctx.payeesMissing;
      out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت و صدور مجوز سرپرستی برای شعبه', tone: 'primary', disabled });
      if (rules.councilEnabled) out.push(council);
    }
  } else if (s === 'COUNCIL') {
    let disabled = notApproved ?? waitingOriginals;
    if (!disabled && claim.finalizedAmount == null) disabled = 'مبلغ خسارت قطعی را شعبه ثبت نکرده است';
    if (!disabled) disabled = ctx.payeesMissing;
    // شورای فنی doesn't give the مجوز سرپرستی itself: it orders ستاد to give it to شعبه.
    out.push({ key: 'PAY_ORDER', label: 'دستور پرداخت — ارسال به مدیریت ستاد برای صدور مجوز سرپرستی', tone: 'primary', disabled });
  }

  // Ask for the originals: شعبه from the کارگزاری (a broker's case) or the بیمه‌گزار (after approving the
  // scans), ستاد from شعبه, شورا via ستاد.
  if (s !== 'BROKER' && !ph.open && custodyOf(ph) !== s) {
    const label = s === 'BRANCH' ? `درخواست اصل مدارک از ${fa[phBase]}` : s === 'HQ' ? 'درخواست اصل مدارک از شعبه' : 'درخواست اصل مدارک (از طریق مدیریت ستاد)';
    out.push({ key: 'REQUEST_PHYSICAL', label, tone: 'ghost', disabled: s === 'BRANCH' ? notApproved : undefined });
  }

  if (dn) {
    // ستاد (سرپرستی) sends a case back to شعبه as «برگشت از سرپرستی به شعبه»; شعبه to the desk below it
    // (the کارگزاری of a broker's case) as «برگشت از شعبه».
    const back = s === 'HQ' && dn === 'BRANCH' ? 'برگشت از سرپرستی به شعبه' : s === 'BRANCH' ? 'برگشت از شعبه' : `ارسال به ${fa[dn]} (عودت برای رفع نقص)`;
    out.push({ key: 'RETURN', label: back, tone: 'warning', needsDeficiencies: true });
    const bottom = directTarget(claim, s);
    if (ctx.isAdmin && dn !== 'POLICYHOLDER' && dn !== bottom) {
      // Skips every desk below (not past a کارگزاری) — the panel asks the operator to confirm (yes / no) first.
      const from = s === 'HQ' ? 'سرپرستی' : fa[s] ?? '';
      out.push({ key: 'RETURN_DIRECT', label: `برگشت از ${from} به ${fa[bottom]}`, tone: 'ghost', adminOnly: true, needsDeficiencies: true, confirm: true });
    }
  }
  if (s !== 'BROKER') out.push({ key: 'REJECT_FINAL', label: 'رد نهایی پرونده', tone: 'danger', needsNote: true });
  return out;
}
