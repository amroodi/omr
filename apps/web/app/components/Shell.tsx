'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { clearToken, Realm } from '../../lib/client';
import { ChangePasswordModal } from './ChangePasswordModal';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
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

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className="lg:grid lg:gap-6" style={{ gridTemplateColumns: '230px minmax(0,1fr)' }}>
        {/* Sidebar */}
        <aside className="mb-4 lg:mb-0">
          <div className="card p-2 lg:sticky lg:top-20">
            <div className="flex lg:flex-col gap-1 overflow-x-auto">
              {nav.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition"
                    style={
                      active
                        ? { background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700 }
                        : { color: 'var(--muted)' }
                    }
                  >
                    <span className="shrink-0">{n.icon}</span>
                    {n.label}
                  </Link>
                );
              })}
              <button
                onClick={() => setShowPw(true)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition mt-auto lg:mt-2"
                style={{ color: 'var(--muted)' }}
              >
                <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" />
                تغییر رمز عبور
              </button>
              <button
                onClick={() => { clearToken(realm); router.push(`/${realm === 'super' ? 'admin' : realm}/login`); }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition"
                style={{ color: 'var(--danger)' }}
              >
                <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" />
                خروج
              </button>
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="min-w-0">
          <div className="mb-5">
            <h1 className="text-2xl font-extrabold">{title}</h1>
            {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
          </div>
          <div className="fade-up">{children}</div>
        </section>
      </div>
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
