import { Icon, NavItem } from '../components/Shell';

const ACCOUNT = 'حساب کاربری';
const CLAIMS = 'خسارت عمر و حوادث';

/** بیمه‌گزار (customer) sidebar menu — the reference portal's two groups: the account, then the claims. */
export const CUSTOMER_NAV: NavItem[] = [
  { group: ACCOUNT, href: '/customer/password', label: 'تغییر کلمه عبور', icon: <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" /> },
  { group: CLAIMS, href: '/customer', label: 'پیشخوان', icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10" /> },
  { group: CLAIMS, href: '/customer/claims/new', label: 'ثبت پرونده خسارت', icon: <Icon path="M12 5v14M5 12h14" /> },
  { group: CLAIMS, href: '/customer/claims', label: 'پیگیری خسارت', icon: <Icon path="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /> },
];

/** Remembered choice of بیمه‌نامه (also pre-selects it on «ثبت پرونده خسارت»). */
export const POLICY_KEY = 'customer.policy';
export interface PolicyRow {
  id: string; line: 'LIFE' | 'ACCIDENT' | null; lineLabel: string | null; policyNumber: string | null; insurerName: string;
  startDate: string | null; endDate: string | null; startIso: string | null; endIso: string | null; inForce: boolean; claimTypes: string[] | null;
}
