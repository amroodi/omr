import { above, actionsFor, causesOf, ActionContext, asLine, typesFor, below, chainOf, DEFAULT_WORKFLOW_MODEL, directTarget, higher, modelFrom, physicalActionsFor, rulesOf, stageLabels, WorkflowModel } from './workflow';

const broker = { brokerTenantId: 'b1' };
const direct = { brokerTenantId: null };

function ctx(over: Partial<ActionContext['claim']> = {}, rest: Partial<ActionContext> = {}): ActionContext {
  return {
    claim: {
      brokerTenantId: 'b1', status: 'UNDER_REVIEW', currentStage: 'BROKER', flowDirection: 'UP', flowPurpose: 'REVIEW',
      returnTargetStage: null, lossNoticeNumber: null, finalizedAmount: null, claimedAmount: '1000', handlingBranchId: null, ...over,
    },
    isAdmin: false,
    hqCeiling: null,
    docs: { count: 2, allApproved: true, rejectedLabels: [], rejectedAnywhere: [] },
    branches: [{ id: 'br1', name: 'شعبه مرکزی', code: '100' }],
    physical: { at: 'BRANCH', open: null },
    ...rest,
  };
}
const keys = (c: ActionContext) => actionsFor(c).map((a) => a.key);
const get = (c: ActionContext, k: string) => actionsFor(c).find((a) => a.key === k);

describe('claim chain', () => {
  it('skips کارگزاری on the DIRECT channel', () => {
    expect(chainOf(broker)).toEqual(['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL']);
    expect(chainOf(direct)).toEqual(['POLICYHOLDER', 'BRANCH', 'HQ', 'COUNCIL']);
    expect(below(direct, 'BRANCH')).toBe('POLICYHOLDER');
    expect(above(broker, 'POLICYHOLDER')).toBe('BROKER');
    expect(above(broker, 'COUNCIL')).toBeNull();
  });

  it('keeps the highest returning desk as the climb-back target', () => {
    expect(higher('HQ', 'BRANCH')).toBe('HQ');
    expect(higher(null, 'BRANCH')).toBe('BRANCH');
  });
});

describe('actionsFor', () => {
  it('بیمه‌گزار must replace rejected documents before sending', () => {
    const c = ctx({ currentStage: 'POLICYHOLDER', flowDirection: 'DOWN', flowPurpose: 'DEFICIENCY' }, { docs: { count: 2, allApproved: false, rejectedLabels: [], rejectedAnywhere: ['گواهی فوت'] } });
    expect(get(c, 'SUBMIT')?.label).toBe('ارسال به کارگزاری');
    expect(get(c, 'SUBMIT')?.disabled).toContain('گواهی فوت');
  });

  it('کارگزاری forwards to شعبه only after approving every document, and picks the branch', () => {
    expect(get(ctx({}, { docs: { count: 2, allApproved: false, rejectedLabels: [], rejectedAnywhere: [] } }), 'FORWARD')?.disabled).toBeTruthy();
    const f = get(ctx(), 'FORWARD')!;
    expect(f.label).toBe('ارسال به شعبه');
    expect(f.disabled).toBeUndefined();
    expect(f.branchOptions).toHaveLength(1);
    expect(keys(ctx())).not.toContain('REJECT_FINAL');
  });

  it('شعبه needs the مبلغ خسارت قطعی (not اعلام خسارت) before forwarding to ستاد', () => {
    expect(get(ctx({ currentStage: 'BRANCH' }), 'FORWARD')?.disabled).toBe('ابتدا مبلغ خسارت قطعی را ثبت کنید');
    expect(get(ctx({ currentStage: 'BRANCH', finalizedAmount: '900' }), 'FORWARD')?.disabled).toBeUndefined();
    expect(get(ctx({ currentStage: 'BRANCH', finalizedAmount: '900' }), 'FORWARD')?.label).toBe('ارسال به مدیریت ستاد');
  });

  it('ستاد can pay or refer; above its ceiling payment is blocked', () => {
    const c = ctx({ currentStage: 'HQ', finalizedAmount: '5000' }, { hqCeiling: '10000' });
    expect(keys(c)).toEqual(expect.arrayContaining(['PAY_ORDER', 'REFER_COUNCIL', 'RETURN', 'REJECT_FINAL']));
    expect(get(c, 'PAY_ORDER')?.disabled).toBeUndefined();
    const over = ctx({ currentStage: 'HQ', finalizedAmount: '50000' }, { hqCeiling: '10000' });
    expect(get(over, 'PAY_ORDER')?.disabled).toContain('سقف');
    expect(get(over, 'REFER_COUNCIL')?.disabled).toBeUndefined();
    expect(get(ctx({ currentStage: 'HQ' }), 'PAY_ORDER')?.disabled).toContain('مبلغ خسارت قطعی');
  });

  it('after شورای فنی returned it, ستاد can only send it back to the council', () => {
    const c = ctx({ currentStage: 'HQ', finalizedAmount: '5000', returnTargetStage: 'COUNCIL' });
    expect(keys(c)).not.toContain('PAY_ORDER');
    expect(get(c, 'REFER_COUNCIL')?.label).toBe('ارسال به شورای فنی');
  });

  it('شورای فنی orders payment down through ستاد', () => {
    expect(get(ctx({ currentStage: 'COUNCIL', finalizedAmount: '1' }), 'PAY_ORDER')?.label).toBe('دستور پرداخت — ارسال به مدیریت ستاد');
    expect(keys(ctx({ currentStage: 'HQ', flowDirection: 'DOWN', flowPurpose: 'PAYMENT', status: 'APPROVED' }))).toEqual(['DOWN_FORWARD']);
    expect(keys(ctx({ currentStage: 'BRANCH', flowDirection: 'DOWN', flowPurpose: 'PAYMENT', status: 'APPROVED' }))).toEqual(['MARK_PAID']);
  });

  it('a return travels desk by desk, with a direct skip for admins only', () => {
    const down = { currentStage: 'HQ' as const, flowDirection: 'DOWN' as const, flowPurpose: 'DEFICIENCY' as const };
    expect(get(ctx(down), 'DOWN_FORWARD')?.label).toBe('ارسال به شعبه برای رفع نقص');
    expect(keys(ctx(down))).not.toContain('DOWN_DIRECT');
    expect(keys(ctx(down, { isAdmin: true }))).toContain('DOWN_DIRECT');
    // the desk just above بیمه‌گزار has nothing to skip
    expect(keys(ctx({ ...down, currentStage: 'BROKER' }, { isAdmin: true }))).toEqual(['FIX_HERE', 'DOWN_FORWARD']);
    // any desk a return reaches may fix it itself — once what was asked is uploaded
    expect(get(ctx({ ...down, currentStage: 'BRANCH' }), 'FIX_HERE')?.disabled).toBeUndefined();
    const missing = { docs: { count: 2, allApproved: true, rejectedLabels: [], rejectedAnywhere: [], deficiencyMissing: ['فیش حقوقی'] } };
    expect(get(ctx({ ...down, currentStage: 'BRANCH' }, missing), 'FIX_HERE')?.disabled).toContain('فیش حقوقی');
    expect(get(ctx({ currentStage: 'POLICYHOLDER', flowDirection: 'DOWN', flowPurpose: 'DEFICIENCY' }, missing), 'SUBMIT')?.disabled).toContain('فیش حقوقی');
    expect(get(ctx({ currentStage: 'BRANCH' }), 'RETURN')?.label).toBe('برگشت از شعبه');
  });

  it('the insurer never skips past the کارگزاری of a broker case', () => {
    expect(directTarget(broker, 'HQ')).toBe('BROKER');
    expect(directTarget(broker, 'BROKER')).toBe('POLICYHOLDER');
    expect(directTarget(direct, 'HQ')).toBe('POLICYHOLDER');
    const hq = { currentStage: 'HQ' as const, finalizedAmount: '1' };
    expect(get(ctx(hq, { isAdmin: true }), 'RETURN_DIRECT')?.label).toBe('برگشت از سرپرستی به کارگزاری');
    // شعبه: the desk below is already the کارگزاری — nothing to skip
    expect(keys(ctx({ currentStage: 'BRANCH' }, { isAdmin: true }))).not.toContain('RETURN_DIRECT');
    const down = { currentStage: 'HQ' as const, flowDirection: 'DOWN' as const, flowPurpose: 'DEFICIENCY' as const };
    expect(get(ctx(down, { isAdmin: true }), 'DOWN_DIRECT')?.label).toBe('ارسال مستقیم به کارگزاری (اختیار مدیریت)');
  });

  it('closed claims offer nothing', () => {
    expect(actionsFor(ctx({ status: 'PAID', currentStage: null }))).toEqual([]);
  });
});

describe('physical documents', () => {
  const none = { at: null, open: null };
  it('شعبه asks بیمه‌گزار only after approving the scans, and cannot forward until the originals arrive', () => {
    const at = { currentStage: 'BRANCH' as const, lossNoticeNumber: '1', finalizedAmount: '1' };
    expect(get(ctx(at, { physical: none }), 'REQUEST_PHYSICAL')?.label).toBe('درخواست اصل مدارک از بیمه‌گزار');
    expect(get(ctx(at, { physical: none, docs: { count: 1, allApproved: false, rejectedLabels: [], rejectedAnywhere: [] } }), 'REQUEST_PHYSICAL')?.disabled).toBeTruthy();
    expect(get(ctx(at, { physical: none }), 'FORWARD')?.disabled).toContain('اصل مدارک');
    expect(keys(ctx(at))).not.toContain('REQUEST_PHYSICAL'); // already at شعبه
  });

  it('a desk waiting for the originals cannot decide yet', () => {
    const c = ctx({ currentStage: 'HQ', finalizedAmount: '1' }, { physical: { at: 'BRANCH', open: { requesterStage: 'HQ', holderStage: 'BRANCH', status: 'REQUESTED' } } });
    expect(get(c, 'PAY_ORDER')?.disabled).toBe('در انتظار دریافت اصل مدارک');
    expect(get(c, 'REFER_COUNCIL')?.disabled).toBe('در انتظار دریافت اصل مدارک');
    expect(keys(c)).not.toContain('REQUEST_PHYSICAL');
    expect(keys(c)).toContain('RETURN');
  });

  it('a council request is relayed by ستاد, sent by شعبه, received by the council', () => {
    const open = (holderStage: any, status: any = 'REQUESTED') => ({ at: 'BRANCH' as const, open: { requesterStage: 'COUNCIL' as const, holderStage, status } });
    expect(physicalActionsFor('HQ', open('HQ'))).toEqual([{ key: 'PHYSICAL_RELAY', label: 'ارسال درخواست اصل مدارک به شعبه' }]);
    expect(physicalActionsFor('BRANCH', open('BRANCH'))).toEqual([{ key: 'PHYSICAL_SEND', label: 'ارسال اصل مدارک به شورای فنی' }]);
    expect(physicalActionsFor('COUNCIL', open('BRANCH', 'SENT'))[0].key).toBe('PHYSICAL_RECEIVE');
    expect(physicalActionsFor('HQ', open('BRANCH'))).toEqual([]);
    expect(physicalActionsFor('POLICYHOLDER', { at: null, open: { requesterStage: 'BRANCH', holderStage: 'POLICYHOLDER', status: 'REQUESTED' } })[0].label).toBe('ارسال اصل مدارک به شعبه');
    expect(physicalActionsFor('COUNCIL', { at: 'COUNCIL', open: null })[0].key).toBe('PHYSICAL_RETURN');
  });

  it('on a broker case شعبه asks the کارگزاری, which sends them on', () => {
    const at = { currentStage: 'BRANCH' as const, lossNoticeNumber: '1', finalizedAmount: '1' };
    const viaBroker = { at: null, base: 'BROKER' as const, open: null };
    expect(get(ctx(at, { physical: viaBroker }), 'REQUEST_PHYSICAL')?.label).toBe('درخواست اصل مدارک از کارگزاری');
    expect(get(ctx(at, { physical: viaBroker }), 'FORWARD')?.disabled).toBe('ابتدا اصل مدارک را از کارگزاری دریافت کنید');
    const asked = { at: null, base: 'BROKER' as const, open: { requesterStage: 'BRANCH' as const, holderStage: 'BROKER' as const, status: 'REQUESTED' as const } };
    expect(physicalActionsFor('BROKER', asked)).toEqual([{ key: 'PHYSICAL_SEND', label: 'ارسال اصل مدارک به شعبه' }]);
    // a council request reaches the کارگزاری only if the originals never left it
    const council = { ...asked, open: { ...asked.open, requesterStage: 'COUNCIL' as const, holderStage: 'BRANCH' as const } };
    expect(physicalActionsFor('BRANCH', council)).toEqual([{ key: 'PHYSICAL_RELAY', label: 'ارسال درخواست اصل مدارک به کارگزاری' }]);
  });
});

describe('Model View', () => {
  const off = (over: Partial<WorkflowModel>): WorkflowModel => ({ ...DEFAULT_WORKFLOW_MODEL, ...over });
  const keys = (c: ActionContext) => actionsFor(c).map((a) => a.key);
  const docsOk = { docs: { count: 1, allApproved: true, rejectedLabels: [], rejectedAnywhere: [] } };

  it('keeps the insurer panel-1 entry way valid, defaulting to the کارگزاری desk', () => {
    expect(modelFrom(null).entry.way).toBe('BROKER');
    expect(modelFrom({ entry: { way: 'ASK' } }).entry.way).toBe('ASK');
    expect(modelFrom({ entry: { way: 'HQ' } }).entry.way).toBe('BROKER');
    expect(modelFrom({ entry: { way: 'CHANNEL' } }).entry.way).toBe('CHANNEL');
  });

  it('keeps «روند سیناد» off unless switched on, with a sane batch and return reasons', () => {
    expect(modelFrom(null).sinad.enabled).toBe(false);
    const m = modelFrom({ sinad: { enabled: true, batchSize: 500 } });
    expect(m.sinad.enabled).toBe(true);
    expect(m.sinad.batchSize).toBe(10);
    expect(m.sinad.returnGroups.length).toBeGreaterThan(0);
    expect(modelFrom({ sinad: { enabled: true, batchSize: 5, returnGroups: [{ label: ' نقص ', items: ['الف', 'الف', ' ', 3] }, { label: '' }] } }).sinad)
      .toEqual({ enabled: true, batchSize: 5, returnGroups: [{ label: 'نقص', items: ['الف'] }] });
  });

  it('keeps today\'s behaviour when nothing is stored', () => {
    expect(modelFrom(null)).toEqual(DEFAULT_WORKFLOW_MODEL);
    expect(modelFrom({ councilEnabled: 'no', panels: { COMPANY: { upload: false } } }).councilEnabled).toBe(true);
    expect(modelFrom({ panels: { COMPANY: { upload: false } } }).panels.COMPANY).toEqual({ upload: false, submit: true });
  });

  it('council off: ستاد has no referral, no ceiling, and the chain drops the desk', () => {
    const m = off({ councilEnabled: false });
    const hq = ctx({ currentStage: 'HQ', flowDirection: 'UP', finalizedAmount: 100, claimedAmount: 100 } as any, { ...docsOk, hqCeiling: 1, physical: { at: 'HQ', open: null }, model: m });
    expect(keys(hq)).not.toContain('REFER_COUNCIL');
    expect(actionsFor(hq).find((a) => a.key === 'PAY_ORDER')?.disabled).toBeUndefined();
    expect(chainOf(broker, m)).not.toContain('COUNCIL');
  });

  it('council off: a case already at the council stays on the chain', () => {
    expect(chainOf({ ...broker, currentStage: 'COUNCIL' }, off({ councilEnabled: false }))).toContain('COUNCIL');
  });

  it('شعبه can forward without loss notice or originals when not required', () => {
    const base = { currentStage: 'BRANCH', flowDirection: 'UP', lossNoticeNumber: null, finalizedAmount: '1' } as any;
    const forward = (model: WorkflowModel) => actionsFor(ctx(base, { ...docsOk, physical: { at: null, open: null }, model })).find((a) => a.key === 'FORWARD');
    expect(forward(DEFAULT_WORKFLOW_MODEL)?.disabled).toBeTruthy();
    expect(forward(off({ requireLossNotice: false, requireOriginals: false }))?.disabled).toBeUndefined();
  });

  it('a blocked panel can\'t submit', () => {
    const a = actionsFor(ctx({ currentStage: 'POLICYHOLDER' } as any, { ...docsOk, submitBlocked: 'x' })).find((k) => k.key === 'SUBMIT');
    expect(a?.disabled).toBe('x');
  });
});

describe('Model View: stages, types and forms', () => {
  it('uses the insurer\'s stage names in action labels', () => {
    const m = modelFrom({ stages: { BROKER: { label: 'معرف' } } });
    expect(stageLabels(m).BROKER).toBe('معرف');
    const a = actionsFor(ctx({ currentStage: 'POLICYHOLDER' } as any, { docs: { count: 1, allApproved: true, rejectedLabels: [], rejectedAnywhere: [] }, model: m }));
    expect(a[0].label).toContain('معرف');
  });
  it('a desk that needn\'t review documents can forward without approvals', () => {
    const m = modelFrom({ requireLossNotice: false, requireOriginals: false, stages: { BRANCH: { reviewDocs: false } } });
    const a = actionsFor(ctx({ currentStage: 'BRANCH', flowDirection: 'UP', finalizedAmount: '1' } as any, { docs: { count: 1, allApproved: false, rejectedLabels: [], rejectedAnywhere: [] }, physical: { at: null, open: null }, model: m }));
    expect(a.find((x) => x.key === 'FORWARD')?.disabled).toBeUndefined();
  });
  it('a نوع پرونده overrides the insurer\'s rule', () => {
    const m = modelFrom({ councilEnabled: true, byType: { MEDICAL_ACCIDENT: { councilEnabled: false }, NONSENSE: { councilEnabled: false } } });
    expect(rulesOf(m, 'MEDICAL_ACCIDENT').councilEnabled).toBe(false);
    expect(rulesOf(m, 'DEATH_ILLNESS').councilEnabled).toBe(true);
    expect(m.byType.NONSENSE).toBeUndefined();
    expect(chainOf({ ...broker, claimType: 'MEDICAL_ACCIDENT' }, m)).not.toContain('COUNCIL');
  });
  it('a line can\'t be given a claim type it doesn\'t cover, nor lose them all', () => {
    expect(modelFrom({ form: { lines: { LIFE: { claimTypes: ['NOPE', 'DEATH_ILLNESS'] } } } }).form.lines.LIFE.claimTypes).toEqual(['DEATH_ILLNESS']);
    expect(modelFrom({ form: { lines: { LIFE: { claimTypes: [] } } } }).form.lines.LIFE.claimTypes.length).toBe(2);
  });
});

describe('Model View: cause lists', () => {
  it('starts with both lists', () => {
    expect(DEFAULT_WORKFLOW_MODEL.form.causeLists.DEATH).toContain('سرطان');
    expect(DEFAULT_WORKFLOW_MODEL.form.causeLists.ACCIDENT).toContain('حادثه ناشی از کار');
    expect(modelFrom({ form: {} }).form.causeLists.DEATH.length).toBe(16);
  });
  it('each نوع پرونده has its own «علت» list; an empty one falls back to its group', () => {
    const m = modelFrom({ form: {} });
    expect(causesOf(m, 'DISABILITY_ILLNESS')).toHaveLength(2);
    expect(causesOf(m, 'DEATH_ILLNESS')).not.toContain(causesOf(m, 'DISABILITY_ILLNESS')[0]);
    expect(causesOf(m, 'DEATH_ACCIDENT')).toContain('جنگ');
    expect(causesOf(m, 'DAILY_GENERAL')).toEqual(m.form.causeLists.ACCIDENT);
    const saved = modelFrom({ form: { caseTypes: [{ code: 'MEDICAL_ACCIDENT', causes: ['x'] }], lines: { LIFE: { causeLabel: 'علت' } } } });
    expect(causesOf(saved, 'MEDICAL_ACCIDENT')).toEqual(['x']);
    expect(saved.form.lines.LIFE.causeLabel).toBe('علت');
    expect(m.form.lines.LIFE.causeLabel).toBe('علت فوت');
    expect(m.form.lines.ACCIDENT.causeLabel).toBe('علت خسارت');
  });
  it('a saved empty list stays empty; an old single list serves both', () => {
    expect(modelFrom({ form: { causeLists: { DEATH: [] } } }).form.causeLists.DEATH).toEqual([]);
    expect(modelFrom({ form: { causes: ['x'] } }).form.causeLists).toEqual({ DEATH: ['x'], ACCIDENT: ['x'] });
    expect(modelFrom({ form: { causes: [] } }).form.causeLists.ACCIDENT.length).toBe(6);
  });
  it('keeps each cause\'s ready text («متن»), strings only', () => {
    expect(modelFrom({ form: {} }).form.causeNotes).toEqual({});
    expect(modelFrom({ form: { causeNotes: { ' سرطان ': ' متن ', بیماری: '', x: 5, '': 'y' } } }).form.causeNotes).toEqual({ سرطان: 'متن' });
    expect(modelFrom({ form: { causeNotes: ['a'] } }).form.causeNotes).toEqual({});
  });
});

describe('نوع بیمه‌نامه (policy kinds)', () => {
  it('starts the three new kinds with no نوع پرونده (filing closed until set in Model View)', () => {
    const m = modelFrom({});
    expect(m.form.lines.LIFE.claimTypes.length).toBeGreaterThan(0);
    expect(m.form.lines.LIABILITY.claimTypes).toEqual([]);
    expect(m.form.lines.CREDIT_LIFE.claimTypes).toEqual([]);
    expect(m.form.lines.SAVINGS_LIFE.claimTypes).toEqual([]);
    expect(typesFor(m, 'LIABILITY')).toEqual([]);
  });
  it('keeps what Super Admin sets for a new kind, in the insurer model and in company groups', () => {
    const m = modelFrom({ form: { lines: { CREDIT_LIFE: { claimTypes: ['DEATH_ILLNESS', 'NOPE'] } }, groups: [{ id: 'g', companyIds: ['c1'], lines: { CREDIT_LIFE: ['DEATH_ILLNESS'] } }] } });
    expect(m.form.lines.CREDIT_LIFE.claimTypes).toEqual(['DEATH_ILLNESS']);
    expect(typesFor(m, 'CREDIT_LIFE', ['c1'])).toEqual(['DEATH_ILLNESS']);
    expect(typesFor(m, 'SAVINGS_LIFE', ['c1'])).toEqual([]);
  });
  it('reads only real kinds from a query', () => {
    expect(asLine('ACCIDENT')).toBe('ACCIDENT');
    expect(asLine('SAVINGS_LIFE')).toBe('SAVINGS_LIFE');
    expect(asLine('X')).toBeUndefined();
    expect(asLine(undefined)).toBeUndefined();
  });
});
