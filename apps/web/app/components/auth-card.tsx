'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { BrandLogo } from './brand';
import { LoginBgSet, RotatingBg } from './RotatingBg';

const LOGINS = [
  { href: '/customer/login', label: 'ورود بیمه‌گزار' },
  { href: '/org/login', label: 'پورتال سازمان' },
];

/**
 * Navigation under a login card: back to the home page, and the other login portal(s). The
 * super-admin login is deliberately not linked (reached only by its direct URL).
 */
export function LoginNav({ onDark }: { onDark?: boolean }) {
  const path = usePathname() || '';
  const style = onDark ? { color: '#fff', borderColor: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.12)' } : undefined;
  return (
    <nav className="login-nav" aria-label="ناوبری">
      <Link href="/" className="login-nav-btn" style={style}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
        صفحهٔ اصلی
      </Link>
      {LOGINS.filter((l) => !path.startsWith(l.href)).map((l) => (
        <Link key={l.href} href={l.href} className="login-nav-btn" style={style}>{l.label}</Link>
      ))}
    </nav>
  );
}

/**
 * Login card. The logo, title and subtitle sit inside the card. With a `bg` (rotating photos), an arrow
 * button folds the card away so the whole background can be enjoyed; a round arrow brings it back.
 */
export function AuthCard({ title, subtitle, children, bg }: { title: string; subtitle?: string; children: ReactNode; bg?: LoginBgSet }) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="min-h-[calc(70*var(--zvh))] flex items-center justify-center">
      {bg && <RotatingBg set={bg} clear={hidden} />}
      <div className={`w-full max-w-sm auth-wrap${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden}>
        <div className={bg ? 'glass p-6 fade-up auth-card' : 'card p-6 fade-up auth-card'} style={{ boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius)' }}>
          {bg && (
            <button type="button" className="auth-fold" onClick={() => setHidden(true)} title="بستن فرم و دیدن کامل تصویر پس‌زمینه" aria-label="بستن فرم ورود">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
          <div className="flex flex-col items-center text-center mb-5">
            <BrandLogo height={104} />
            <h1 className="text-xl font-extrabold mt-3">{title}</h1>
            {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
          </div>
          {children}
        </div>
        <LoginNav />
      </div>
      {bg && hidden && (
        <button type="button" className="auth-unfold" onClick={() => setHidden(false)} title="نمایش فرم ورود" aria-label="نمایش فرم ورود">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 15l-6-6-6 6" /></svg>
          <span>نمایش فرم ورود</span>
        </button>
      )}
    </div>
  );
}
