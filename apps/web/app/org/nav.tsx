import { Icon, NavItem } from '../components/Shell';

const WORK = 'کار با پرونده‌ها';
const ADMIN = 'مدیریت و تنظیمات';

/**
 * Org panel menu in two categories: day-to-day case work, then administration. Case lists live in the
 * Work Desk (search + queues); «گزارش‌گیری» is the report builder.
 */
export const ORG_NAV: NavItem[] = [
  { group: WORK, href: '/org/work-desk', label: 'میز کار', icon: <Icon path="M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10" />, perm: 'claim:read' },
  { group: WORK, href: '/org/claims/on-behalf', label: 'ثبت پرونده برای بیمه‌گزار', icon: <Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M12 18v-6M9 15h6" />, perm: 'claim:file-on-behalf', panels: ['BROKER'] },
  { group: WORK, href: '/org/track', label: 'پیگیری وضعیت پرونده', icon: <Icon path="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />, perm: 'tenant:settings' },
  { group: WORK, href: '/org/reminders', label: 'یادآورها', icon: <Icon path="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />, perm: 'claim:read' },
  { group: WORK, href: '/org/reports', label: 'گزارش‌گیری', icon: <Icon path="M3 3v18h18M7 15l4-4 3 3 5-6" />, perm: 'claim:read' },

  { group: ADMIN, href: '/org/import', label: 'ورود دسته‌ای', icon: <Icon path="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />, perm: 'import:batch' },
  { group: ADMIN, href: '/org/users', label: 'کاربران و نقش‌ها', icon: <Icon path="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />, perm: ['user:manage', 'role:manage'] },
  { group: ADMIN, href: '/org/policyholders', label: 'بیمه‌گزاران', icon: <Icon path="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" />, perm: 'customer:manage' },
  { group: ADMIN, href: '/org/sharing', label: 'اشتراک‌گذاری', icon: <Icon path="M18 8a3 3 0 10-2.83-4M6 15a3 3 0 100 6 3 3 0 000-6zM18 19a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />, perm: 'tenant:settings' },
  { group: ADMIN, href: '/org/integration', label: 'اتصال و API', icon: <Icon path="M10 13a5 5 0 007.07 0l1.93-1.93a5 5 0 00-7.07-7.07l-1 1M14 11a5 5 0 00-7.07 0L5 12.93a5 5 0 007.07 7.07l1-1" />, perm: 'apikey:manage' },
  { group: ADMIN, href: '/org/settings', label: 'تنظیمات سازمان', icon: <Icon path="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />, perm: 'tenant:settings' },
  { group: ADMIN, href: '/org/work-desk?customize=1', label: 'شخصی‌سازی میز کار', icon: <Icon path="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />, perm: 'claim:read' },
  { group: ADMIN, href: '/org/security', label: 'ورود دومرحله‌ای', icon: <Icon path="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" /> },
  { group: ADMIN, href: '#password', special: 'password', label: 'تغییر رمز عبور', icon: <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" /> },
  { group: ADMIN, href: '/org/claims/trash', label: 'سطل بازیافت', icon: <Icon path="M3 6h18M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />, perm: 'claim:delete' },
];
