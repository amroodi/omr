'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { clearToken, client, getTenantSlug, hasPerm, Realm } from '../../lib/client';
import { ChangePasswordModal } from './ChangePasswordModal';
import { NotificationBell } from './NotificationBell';
import { BrandMark } from './brand';
import { ThemeToggle } from '../theme-toggle';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Only show this item when the signed-in user holds this permission (or any of the list). */
  perm?: string | string[];
}

/**
 * Panel shell, modelled 1:1 on the Alborz/Sinad portal: a white top bar carrying a
 * brand-colour page title + breadcrumb, a dark-navy collapsible right sidebar with a
 * circular tenant logo and the menu, and a light-grey content area. Org and بیمه‌گزار
 * panels both use it; the same props drive every page.
 */
export function Shell({
  title,
  subtitle,
  breadcrumb,
  action,
  sectionLabel,
  nav,
  realm,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Trailing crumb after «صفحه اصلی /». Omit on the landing page of a panel. */
  breadcrumb?: string;
  /** Optional top-left bar button (e.g. a help / tutorial link). */
  action?: ReactNode;
  /** Optional navy group header shown above the nav list. */
  sectionLabel?: string;
  nav: NavItem[];
  realm: Realm;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rail, setRail] = useState(true); // desktop: collapsed icon rail by default
  const [open, setOpen] = useState(false); // mobile: off-canvas drawer
  const [brand, setBrand] = useState<{ name: string; hasLogo: boolean; slug: string; logoSrc?: string | null } | null>(null);

  useEffect(() => {
    setMounted(true);
    try { setRail(localStorage.getItem('navRail') !== '0'); } catch {}
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    let active = true;
    const tenantBrand = () => client.get<any>('/tenant/branding')
      .then((b) => { if (active) setBrand({ name: b.name, hasLogo: !!b.logoUrl, slug: getTenantSlug() }); })
      .catch(() => { if (active) setBrand(null); });
    if (realm === 'customer') {
      // The بیمه‌گزار panel shows the represented company's own name + logo (falls back to the brokerage's).
      client.get<{ company: { id: string; name: string; hasLogo: boolean } | null }>('/customer/me', 'customer')
        .then((m) => {
          if (!active) return;
          if (!m.company) return tenantBrand();
          setBrand({ name: m.company.name, hasLogo: m.company.hasLogo, slug: getTenantSlug(), logoSrc: m.company.hasLogo ? `${client.base}/policyholder-companies/${m.company.id}/logo` : null });
        })
        .catch(() => tenantBrand());
    } else tenantBrand();
    return () => { active = false; };
  }, [realm]);

  const toggleRail = () => setRail((r) => { const n = !r; try { localStorage.setItem('navRail', n ? '1' : '0'); } catch {} return n; });
  const visibleNav = nav.filter((n) => !n.perm || (mounted && hasPerm(realm, n.perm)));
  const homeHref = realm === 'customer' ? '/customer' : realm === 'super' ? '/admin' : '/org';
  const logout = () => { clearToken(realm); router.push(`/${realm === 'super' ? 'admin' : realm}/login`); };
  const logoUrl = brand?.logoSrc !== undefined ? brand.logoSrc : brand?.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${brand.slug}` : null;

  const PW_ICON = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4';
  const OUT_ICON = 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9';

  return (
    <div className="pshell" dir="rtl">
      {/* ── Content column (top bar + scrolling content) ── */}
      <div className="pshell-main">
        <header className="ptopbar">
          <button
            onClick={() => setOpen(true)}
            className="btn btn-ghost btn-sm no-print"
            style={{ display: 'none' }}
            data-mobile-menu
            aria-label="منو"
          >
            <Icon path="M4 6h16M4 12h16M4 18h16" />
          </button>
          <span className="ptopbar-title">{title}</span>
          <span className="pbreadcrumb">
            <Link href={homeHref}>صفحه اصلی</Link>{breadcrumb ? ` / ${breadcrumb}` : ''}
          </span>
          <span className="ptopbar-spacer" />
          {action && <span className="no-print">{action}</span>}
          <span className="no-print"><NotificationBell realm={realm} /></span>
          <span className="no-print"><ThemeToggle /></span>
        </header>

        <div className="pshell-content">
          <div className="pshell-wrap fade-up">{children}</div>
        </div>
      </div>

      {/* ── Navy sidebar (right, collapsible) ── */}
      <aside className={`psidebar no-print ${rail ? 'is-rail' : ''} ${open ? 'is-open' : ''}`}>
        <div className="psidebar-logo">
          <Link href={homeHref} className="circle" aria-label="خانه">
            {logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logoUrl} alt="" />
              : <BrandMark size={rail ? 30 : 74} />}
          </Link>
          <div className="psidebar-name">{brand?.name || 'دامون'}</div>
          {subtitle && <div className="psidebar-sub">{subtitle}</div>}
        </div>

        <button className="psidebar-toggle" onClick={toggleRail}>
          <span className="lbl">بستن منو</span>
          <Icon path={rail ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
        </button>

        <nav className="psidebar-nav">
          {sectionLabel && (
            <div className="pnav-section">
              <span className="ico"><Icon path="M4 6h16M4 12h16M4 18h16" /></span>
              <span className="lbl">{sectionLabel}</span>
            </div>
          )}
          {visibleNav.map((n) => {
            const active = pathname === n.href;
            return (
              <Link key={n.href} href={n.href} className={`pnav-item ${active ? 'is-active' : ''}`} title={n.label}>
                <span className="ico">{n.icon}</span>
                <span className="lbl">{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="psidebar-foot">
          <button onClick={() => setShowPw(true)} className="pnav-item" title="تغییر رمز عبور">
            <span className="ico"><Icon path={PW_ICON} /></span>
            <span className="lbl">تغییر رمز عبور</span>
          </button>
          <button onClick={logout} className="pnav-item" title="خروج">
            <span className="ico" style={{ color: 'var(--danger)' }}><Icon path={OUT_ICON} /></span>
            <span className="lbl">خروج</span>
          </button>
        </div>
      </aside>

      <div className={`psidebar-scrim ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} />
      {showPw && <ChangePasswordModal realm={realm} onClose={() => setShowPw(false)} />}

      {/* Mobile: reveal the hamburger (desktop keeps the in-sidebar toggle). */}
      <style>{`@media (max-width: 860px){ [data-mobile-menu]{ display:inline-flex !important; } }`}</style>
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
