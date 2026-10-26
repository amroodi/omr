import { Icon, NavItem } from '../components/Shell';

/** بیمه‌گزار (customer) sidebar menu — mirrors the reference portal's grouped menu. */
export const CUSTOMER_NAV: NavItem[] = [
  { href: '/customer', label: 'پیشخوان', icon: <Icon path="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10" /> },
  { href: '/customer/claims/new', label: 'ثبت پرونده خسارت', icon: <Icon path="M12 5v14M5 12h14" /> },
];

/** Remembered choice of بیمه‌نامه (also pre-selects it on «ثبت پرونده خسارت»). */
export const POLICY_KEY = 'customer.policy';
export interface PolicyRow {
  id: string; line: 'LIFE' | 'ACCIDENT' | null; lineLabel: string | null; policyNumber: string | null; insurerName: string;
  startDate: string | null; endDate: string | null; startIso: string | null; endIso: string | null; inForce: boolean; claimTypes: string[] | null;
}
