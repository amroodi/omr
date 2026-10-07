'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, getTenantSlug } from '../../lib/client';
import { BrandMark } from './brand';
import { ThemeToggle } from '../theme-toggle';

/**
 * App header. On the org and بیمه‌گزار panels it shows the current organization's logo + name
 * (fetched from the public branding endpoint); elsewhere it shows the platform brand + the
 * public entry links.
 */
export function AppHeader() {
  const path = usePathname() || '/';
  const inOrg = path.startsWith('/org') && path !== '/org/login';
  const inCustomer = path.startsWith('/customer') && path !== '/customer/login';
  const orgBranded = inOrg || inCustomer;

  const [brand, setBrand] = useState<{ name: string; hasLogo: boolean; slug: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!orgBranded) { setBrand(null); return; }
    client.get<any>('/tenant/branding')
      .then((b) => { if (active) setBrand({ name: b.name, hasLogo: !!b.logoUrl, slug: getTenantSlug() }); })
      .catch(() => { if (active) setBrand(null); });
    return () => { active = false; };
  }, [orgBranded, path]);

  const logoUrl = brand?.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${brand.slug}` : null;
  const homeHref = inCustomer ? '/customer' : inOrg ? '/org' : '/';

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--surface) 82%, transparent)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-3">
        <a href={homeHref} className="flex items-center gap-2.5 min-w-0">
          {orgBranded && logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ height: 32, width: 'auto', maxWidth: 120, borderRadius: 6, objectFit: 'contain' }} />
          ) : (
            <BrandMark />
          )}
          <span className="font-extrabold text-lg truncate">{orgBranded && brand ? brand.name : 'دامون'}</span>
          {inCustomer && <span className="text-xs shrink-0 px-2 py-0.5 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>پورتال بیمه‌گزار</span>}
        </a>
        {!orgBranded && (
          <nav className="hidden sm:flex gap-1 text-sm mr-auto">
            <a href="/customer/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">بیمه‌گزار</a>
            <a href="/org/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">پورتال سازمان</a>
            <a href="/admin/login" className="px-3 py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition">مدیر سکو</a>
          </nav>
        )}
        <div className={orgBranded ? 'mr-auto' : 'sm:mr-0 mr-auto'}>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
