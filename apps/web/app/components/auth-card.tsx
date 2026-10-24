'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { BrandMark } from './brand';

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

/** `bg` sets a full-screen background image behind the card (light + dark variants). */
export function AuthCard({ title, subtitle, children, bg }: { title: string; subtitle?: string; children: ReactNode; bg?: { light: string; dark: string } }) {
  return (
    <div className="min-h-[calc(70*var(--zvh))] flex items-center justify-center">
      {bg && (
        <>
          <div className="auth-bg auth-bg-light" style={{ backgroundImage: `url(${bg.light})` }} aria-hidden />
          <div className="auth-bg auth-bg-dark" style={{ backgroundImage: `url(${bg.dark})` }} aria-hidden />
        </>
      )}
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <BrandMark size={48} />
          <h1 className="text-xl font-extrabold mt-3" style={bg ? { textShadow: '0 1px 10px rgba(0,0,0,0.12)' } : undefined}>{title}</h1>
          {subtitle && <p className="text-sm mt-1 text-center" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        </div>
        <div className={bg ? 'glass p-6 fade-up' : 'card p-6 fade-up'} style={{ boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius)' }}>
          {children}
        </div>
        <LoginNav />
      </div>
    </div>
  );
}
