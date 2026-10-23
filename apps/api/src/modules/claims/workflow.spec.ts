import { above, actionsFor, ActionContext, below, chainOf, higher, physicalActionsFor } from './workflow';

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

  it('شعبه needs اعلام خسارت before forwarding to ستاد', () => {
    expect(get(ctx({ currentStage: 'BRANCH' }), 'FORWARD')?.disabled).toBe('ابتدا اعلام خسارت را ثبت کنید');
    expect(get(ctx({ currentStage: 'BRANCH', lossNoticeNumber: '123' }), 'FORWARD')?.label).toBe('ارسال به مدیریت ستاد');
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
    expect(get(ctx(down), 'DOWN_FORWARD')?.label).toBe('ارسال به شعبه');
    expect(keys(ctx(down))).not.toContain('DOWN_DIRECT');
    expect(keys(ctx(down, { isAdmin: true }))).toContain('DOWN_DIRECT');
    // the desk just above بیمه‌گزار has nothing to skip
    expect(keys(ctx({ ...down, currentStage: 'BROKER' }, { isAdmin: true }))).toEqual(['DOWN_FORWARD']);
    expect(get(ctx({ currentStage: 'BRANCH' }), 'RETURN')?.label).toBe('ارسال به کارگزاری (عودت برای رفع نقص)');
  });

  it('closed claims offer nothing', () => {
    expect(actionsFor(ctx({ status: 'PAID', currentStage: null }))).toEqual([]);
  });
});

describe('physical documents', () => {
  const none = { at: null, open: null };
  it('شعبه asks بیمه‌گزار only after approving the scans, and cannot forward until the originals arrive', () => {
    const at = { currentStage: 'BRANCH' as const, lossNoticeNumber: '1' };
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
});
