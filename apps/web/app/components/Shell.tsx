'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { clearToken, hasPerm, Realm } from '../../lib/client';
import { ChangePasswordModal } from './ChangePasswordModal';
import { NotificationBell } from './NotificationBell';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Only show this item when the signed-in user holds this permission (or any of the list). */
  perm?: string | string[];
}

export function Shell({
  title,
  subtitle,
  nav,
  realm,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  realm: Realm;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Permissions live in localStorage (empty during SSR), so only gate after mount to avoid a
  // hydration mismatch. Before mount we show just the unrestricted items.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const visibleNav = nav.filter((n) => !n.perm || (mounted && hasPerm(realm, n.perm)));
  const logout = () => { clearToken(realm); router.push(`/${realm === 'super' ? 'admin' : realm}/login`); };
  const PW_ICON = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4';
  const OUT_ICON = 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9';
  const MORE_ICON = 'M5 12h.01M12 12h.01M19 12h.01';

  // Mobile bottom bar: up to 4 nav items inline, the rest (+ account actions) under «بیشتر».
  const barItems = visibleNav.slice(0, 4);
  const moreNav = visibleNav.slice(4);

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className="lg:grid lg:gap-6" style={{ gridTemplateColumns: '230px minmax(0,1fr)' }}>
        {/* Sidebar — desktop only */}
        <aside className="hidden lg:block">
          <div className="card p-2 lg:sticky lg:top-20">
            <div className="flex flex-col gap-1">
              {visibleNav.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition"
                    style={active ? { background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700 } : { color: 'var(--muted)' }}
                  >
                    <span className="shrink-0">{n.icon}</span>
                    {n.label}
                  </Link>
                );
              })}
              <button onClick={() => setShowPw(true)} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition mt-2" style={{ color: 'var(--muted)' }}>
                <Icon path={PW_ICON} /> تغییر رمز عبور
              </button>
              <button onClick={logout} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition" style={{ color: 'var(--danger)' }}>
                <Icon path={OUT_ICON} /> خروج
              </button>
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="min-w-0 pb-24 lg:pb-0">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold">{title}</h1>
              {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
            </div>
            <NotificationBell realm={realm} />
          </div>
          <div className="fade-up">{children}</div>
        </section>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40" style={{ background: 'color-mix(in srgb, var(--surface) 92%, transparent)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(10px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-stretch">
          {barItems.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5" style={{ color: active ? 'var(--brand)' : 'var(--muted)', fontWeight: active ? 700 : 400 }}>
                <span className="shrink-0">{n.icon}</span>
                <span className="text-[10px] leading-none truncate max-w-full px-1">{n.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5" style={{ color: moreOpen ? 'var(--brand)' : 'var(--muted)' }}>
            <Icon path={MORE_ICON} />
            <span className="text-[10px] leading-none">بیشتر</span>
          </button>
        </div>
      </nav>

      {/* «بیشتر» sheet: overflow nav items + account actions */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.45)' }} />
          <div className="absolute bottom-0 inset-x-0 card p-3 space-y-1" style={{ borderRadius: '18px 18px 0 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-2" style={{ background: 'var(--border-strong)' }} />
            {moreNav.map((n) => {
              const active = pathname === n.href;
              return (
                <Link key={n.href} href={n.href} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition" style={active ? { background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700 } : { color: 'var(--text)' }}>
                  <span className="shrink-0">{n.icon}</span>{n.label}
                </Link>
              );
            })}
            <button onClick={() => { setMoreOpen(false); setShowPw(true); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm" style={{ color: 'var(--muted)' }}>
              <Icon path={PW_ICON} /> تغییر رمز عبور
            </button>
            <button onClick={logout} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm" style={{ color: 'var(--danger)' }}>
              <Icon path={OUT_ICON} /> خروج
            </button>
          </div>
        </div>
      )}
      {showPw && <ChangePasswordModal realm={realm} onClose={() => setShowPw(false)} />}
    </div>
  );
}

export function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
