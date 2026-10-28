import { TenantKind } from '@prisma/client';

/**
 * «اعلام خسارت» rules — who may report (file) a claim, from which panel, and on which desk the new case
 * starts. Each organization's admin sets them in «تنظیمات سازمان › اعلام خسارت»:
 *  - a کارگزاری sets them for its بیمه‌گزار companies, its نمایندگان and its own operators;
 *  - a بیمه‌گر sets them for its شعبه / ستاد / شورای فنی operators and for نمایندگان (on its cases).
 * A نماینده's claim must pass both the brokerage's and the insurer's rule (both on, a desk both allow).
 */
export const NOTICE_SOURCES = ['POLICYHOLDER', 'REPRESENTATIVE', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'] as const;
export type NoticeSource = (typeof NOTICE_SOURCES)[number];
export const NOTICE_TARGETS = ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'] as const;
export type NoticeTarget = (typeof NOTICE_TARGETS)[number];

export interface NoticeRule { enabled: boolean; targets: NoticeTarget[]; default: NoticeTarget }
export type NoticeRules = Partial<Record<NoticeSource, NoticeRule>>;

export const SOURCE_FA: Record<NoticeSource, string> = {
  POLICYHOLDER: 'بیمه‌گزار (ورود با کد بیمه‌گزار)', REPRESENTATIVE: 'نماینده', BROKER: 'کاربران کارگزاری',
  BRANCH: 'کاربران شعبه', HQ: 'کاربران ستاد', COUNCIL: 'شورای فنی',
};
export const TARGET_FA: Record<NoticeTarget, string> = {
  POLICYHOLDER: 'بیمه‌گزار (بارگذاری مدارک و ارسال)', BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'ستاد', COUNCIL: 'شورای فنی',
};

/** The sources each kind of organization decides for. */
export const SOURCES_OF: Record<TenantKind, NoticeSource[]> = {
  BROKER: ['POLICYHOLDER', 'REPRESENTATIVE', 'BROKER'],
  INSURER: ['REPRESENTATIVE', 'BRANCH', 'HQ', 'COUNCIL'],
} as Record<TenantKind, NoticeSource[]>;

/** Desks a case from this source may start on (an insurer's own filings have no کارگزاری desk). */
export const TARGETS_OF: Record<NoticeSource, NoticeTarget[]> = {
  POLICYHOLDER: ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'],
  REPRESENTATIVE: ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'],
  BROKER: ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'],
  BRANCH: ['POLICYHOLDER', 'BRANCH', 'HQ', 'COUNCIL'],
  HQ: ['POLICYHOLDER', 'BRANCH', 'HQ', 'COUNCIL'],
  COUNCIL: ['POLICYHOLDER', 'BRANCH', 'HQ', 'COUNCIL'],
};

/** Today's behaviour, used until an admin changes anything. */
const DEFAULTS: Record<'BROKER' | 'INSURER', NoticeRules> = {
  BROKER: {
    POLICYHOLDER: { enabled: true, targets: ['POLICYHOLDER'], default: 'POLICYHOLDER' },
    REPRESENTATIVE: { enabled: true, targets: ['POLICYHOLDER'], default: 'POLICYHOLDER' },
    BROKER: { enabled: true, targets: ['POLICYHOLDER', 'BROKER'], default: 'BROKER' },
  },
  INSURER: {
    REPRESENTATIVE: { enabled: true, targets: ['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'], default: 'POLICYHOLDER' },
    BRANCH: { enabled: true, targets: ['BRANCH'], default: 'BRANCH' },
    HQ: { enabled: true, targets: ['BRANCH', 'HQ'], default: 'BRANCH' },
    COUNCIL: { enabled: false, targets: ['COUNCIL'], default: 'COUNCIL' },
  },
};

/** The org's rules for its own sources: stored values over the defaults, cleaned of anything invalid. */
export function rulesFor(kind: TenantKind | string, stored: unknown): NoticeRules {
  const k = kind === 'INSURER' ? 'INSURER' : 'BROKER';
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, any>;
  const out: NoticeRules = {};
  for (const src of SOURCES_OF[k as TenantKind]) {
    const def = DEFAULTS[k][src]!;
    const r = raw[src];
    if (!r || typeof r !== 'object') { out[src] = { ...def, targets: [...def.targets] }; continue; }
    const allowed = TARGETS_OF[src];
    const targets = Array.isArray(r.targets) ? allowed.filter((t) => r.targets.includes(t)) : def.targets;
    const list = targets.length ? targets : def.targets;
    out[src] = { enabled: typeof r.enabled === 'boolean' ? r.enabled : def.enabled, targets: list, default: list.includes(r.default) ? r.default : list[0] };
  }
  return out;
}

/** Combine the brokerage's and the insurer's rule for a نماینده (both must allow). */
export function combine(a: NoticeRule | undefined, b: NoticeRule | undefined): NoticeRule | undefined {
  if (!a) return b;
  if (!b) return a;
  const targets = a.targets.filter((t) => b.targets.includes(t));
  return { enabled: a.enabled && b.enabled && targets.length > 0, targets, default: targets.includes(a.default) ? a.default : targets[0] ?? a.default };
}
