import { Icon, NavItem } from '../components/Shell';

/** بیمه‌گزار (customer) sidebar menu — mirrors the reference portal's grouped menu. */
export const CUSTOMER_NAV: NavItem[] = [
  { href: '/customer', label: 'پرونده‌های من', icon: <Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /> },
  { href: '/customer/claims/new', label: 'ثبت پرونده خسارت', icon: <Icon path="M12 5v14M5 12h14" /> },
];
