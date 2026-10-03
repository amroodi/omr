import { Icon, NavItem } from '../components/Shell';

export const ORG_NAV: NavItem[] = [
  { href: '/org', label: 'پرونده‌ها', icon: <Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /> },
  { href: '/org/claims', label: 'پرونده‌های خسارت', icon: <Icon path="M12 2l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V5l7-3z" /> },
  { href: '/org/assessor', label: 'ارزیابی مدارک', icon: <Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 15l2 2 4-4" /> },
  { href: '/org/import', label: 'ورود دسته‌ای', icon: <Icon path="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /> },
  { href: '/org/users', label: 'کاربران و نقش‌ها', icon: <Icon path="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /> },
  { href: '/org/sharing', label: 'اشتراک‌گذاری', icon: <Icon path="M18 8a3 3 0 10-2.83-4M6 15a3 3 0 100 6 3 3 0 000-6zM18 19a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /> },
];
