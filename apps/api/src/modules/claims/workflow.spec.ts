import { above, actionsFor, ActionContext, below, chainOf, higher } from './workflow';

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
