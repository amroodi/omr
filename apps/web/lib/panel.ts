/**
 * The separate panels. Org side: کارگزاری, شعبه, ستاد and شورای فنی; customer side: بیمه‌گزار and نماینده.
 * Three login pages: بیمه‌گزار and نماینده share one (/customer/login), کارگزاری has its own
 * (/org/login), and the insurer's شعبه, ستاد and شورای فنی share one (/insurer/login) — the account
 * decides which of them it is. Each panel has its own name and accent colour; the pages behind the
 * login are shared (the same case moves from desk to desk), with the menu narrowed to that panel.
 */
export type OrgPanel = 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';
export type CustomerPanel = 'COMPANY' | 'REPRESENTATIVE';
export type PanelKey = OrgPanel | CustomerPanel;

export interface PanelInfo { label: string; login: string; accent: string; title: string; subtitle: string }

export const PANELS: Record<PanelKey, PanelInfo> = {
  BROKER: { label: 'پنل کارگزاری', login: '/org/login', accent: '#0ea5e9', title: 'ورود کارگزاری', subtitle: 'پنل کارگزاری — رسیدگی و پیگیری پرونده‌ها' },
  BRANCH: { label: 'پنل شعبه', login: '/insurer/login', accent: '#16a34a', title: 'ورود بیمه‌گر', subtitle: 'شعبه، مدیریت ستاد و شورای فنی' },
  HQ: { label: 'پنل ستاد', login: '/insurer/login', accent: '#7c3aed', title: 'ورود بیمه‌گر', subtitle: 'شعبه، مدیریت ستاد و شورای فنی' },
  COUNCIL: { label: 'پنل شورای فنی', login: '/insurer/login', accent: '#b45309', title: 'ورود بیمه‌گر', subtitle: 'شعبه، مدیریت ستاد و شورای فنی' },
  COMPANY: { label: 'پنل بیمه‌گزار', login: '/customer/login', accent: '#f7931e', title: 'ورود بیمه‌گزار و نماینده', subtitle: 'اعلام و پیگیری خسارت عمر و حوادث' },
  REPRESENTATIVE: { label: 'پنل نماینده', login: '/customer/login', accent: '#0d9488', title: 'ورود بیمه‌گزار و نماینده', subtitle: 'اعلام و پیگیری خسارت عمر و حوادث' },
};

const ORG_KEY = 'omr_panel';
const CUSTOMER_KEY = 'omr_cpanel';

export function rememberPanel(realm: 'org' | 'customer', p: PanelKey): void {
  try { localStorage.setItem(realm === 'org' ? ORG_KEY : CUSTOMER_KEY, p); } catch { /* ignore */ }
}

export function lastPanel(realm: 'org' | 'customer'): PanelKey | null {
  try {
    const v = localStorage.getItem(realm === 'org' ? ORG_KEY : CUSTOMER_KEY) as PanelKey | null;
    return v && v in PANELS ? v : null;
  } catch { return null; }
}

/** Where a signed-out user of this realm goes: the login page of the panel they last used. */
export function panelLogin(realm: 'org' | 'customer'): string {
  const p = lastPanel(realm);
  return p ? PANELS[p].login : realm === 'org' ? '/org/login' : '/customer/login';
}
