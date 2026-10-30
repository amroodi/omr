'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { clearToken, client, getTenantSlug, hasPerm, Realm } from '../../lib/client';
import { lastPanel, PanelKey, PANELS, rememberPanel } from '../../lib/panel';
import { ChangePasswordModal } from './ChangePasswordModal';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from '../theme-toggle';
import { WallpaperPicker } from './WallpaperPicker';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Only show this item when the signed-in user holds this permission (or any of the list). */
  perm?: string | string[];
  /** Category heading the item sits under; consecutive items with the same group share one heading. */
  group?: string;
  /** A menu entry that opens something instead of navigating («تغییر رمز عبور»). */
  special?: 'password';
  /** Only in these panels (e.g. «ثبت پرونده برای بیمه‌گزار» is a کارگزاری job). Omit = every panel. */
  panels?: PanelKey[];
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
  const railKey = realm === 'customer' ? 'navRail.customer' : 'navRail';
  const [mounted, setMounted] = useState(false);
  const [rail, setRail] = useState(true); // desktop: collapsed icon rail by default
  const [open, setOpen] = useState(false); // mobile: off-canvas drawer
  const [brand, setBrand] = useState<{ name: string; hasLogo: boolean; slug: string; logoSrc?: string | null } | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // بیمه‌گزار panel: the brokerage and the policy year in force, under the logo (like the insurer's portal).
  const [card, setCard] = useState<{ broker: string; period: string | null } | null>(null);
  // Which separate panel this is (پنل کارگزاری / شعبه / ستاد / شورای فنی / بیمه‌گزار / نماینده).
  const [panel, setPanel] = useState<PanelKey | null>(null);

  useEffect(() => {
    setMounted(true);
    // Staff panels start as an icon rail; the بیمه‌گزار panel starts with the menu open (its own setting).
    try { const v = localStorage.getItem(railKey); setRail(v === null ? realm !== 'customer' : v !== '0'); } catch {}
    if (realm !== 'super') setPanel(lastPanel(realm));
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    let active = true;
    const tenantBrand = () => client.get<any>('/tenant/branding')
      .then((b) => { if (active) setBrand({ name: b.name, hasLogo: !!b.logoUrl, slug: getTenantSlug() }); })
      .catch(() => { if (active) setBrand(null); });
    // «نام کاربر» in the top bar: the operator (org / super) or the بیمه‌گزار company.
    if (realm !== 'customer') client.get<{ name: string | null; panel?: PanelKey | null }>('/auth/me', realm).then((m) => {
      if (!active) return;
      setUserName(m.name);
      if (realm === 'org' && m.panel) { setPanel(m.panel); rememberPanel('org', m.panel); }
    }).catch(() => {});
    if (realm === 'customer') {
      // The بیمه‌گزار panel shows the represented company's own name + logo (falls back to the brokerage's).
      client.get<{ company: { id: string; name: string; hasLogo: boolean } | null; brokerName?: string; policyPeriod?: string | null; brokerPanel?: boolean; representative?: boolean; fullName?: string | null }>('/customer/me', 'customer')
        .then((m) => {
          if (!active) return;
          const p: PanelKey = m.representative ? 'REPRESENTATIVE' : 'COMPANY';
          setPanel(p); rememberPanel('customer', p);
          // A نماینده is shown by name (and their company), a company login by the company.
          setUserName(m.representative && m.fullName ? `${m.fullName}${m.company ? ` — ${m.company.name}` : ''}` : m.company?.name ?? (m.brokerPanel ? `کارگزاری — ${m.brokerName ?? ''}` : null));
          if (m.brokerName) setCard({ broker: m.brokerName, period: m.policyPeriod ?? null });
          if (!m.company) return tenantBrand();
          setBrand({ name: m.company.name, hasLogo: m.company.hasLogo, slug: getTenantSlug(), logoSrc: m.company.hasLogo ? `${client.base}/policyholder-companies/${m.company.id}/logo` : null });
        })
        .catch(() => tenantBrand());
    } else tenantBrand();
    return () => { active = false; };
  }, [realm]);

  const toggleRail = () => setRail((r) => { const n = !r; try { localStorage.setItem(railKey, n ? '1' : '0'); } catch {} return n; });
  const visibleNav = nav.filter((n) => (!n.perm || (mounted && hasPerm(realm, n.perm))) && (!n.panels || !panel || n.panels.includes(panel)));
  const info = panel ? PANELS[panel] : null;
  const homeHref = realm === 'customer' ? '/customer' : realm === 'super' ? '/admin' : '/org/work-desk';
  // «بازگشت»: one step back when the user arrived from inside the site, otherwise to the panel home.
  const isHome = pathname === homeHref || pathname === '/org/welcome';
  const goBack = () => {
    let internal = false;
    try { internal = !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch { /* ignore */ }
    if (internal && window.history.length > 1) router.back();
    else router.push(homeHref);
  };
  // Back to this panel's own login page.
  const logout = () => { clearToken(realm); router.push(info ? info.login : `/${realm === 'super' ? 'admin' : realm}/login`); };
  const logoUrl = brand?.logoSrc !== undefined ? brand.logoSrc : brand?.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${brand.slug}` : null;

  const PW_ICON = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4';
  const OUT_ICON = 'M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9';

  return (
    <div className={`pshell${info ? ' has-panel' : ''}`} dir="rtl" style={info ? { ['--panel-accent' as any]: info.accent } : undefined}>
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
          {!isHome && (
            <button onClick={goBack} className="pback no-print" title="بازگشت به صفحهٔ قبل" aria-label="بازگشت">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6" /></svg>
              <span className="lbl">بازگشت</span>
            </button>
          )}
          {info && <span className="panel-chip" title={info.label}>{info.label}</span>}
          <span className="ptopbar-title">{title}</span>
          <span className="pbreadcrumb">
            <Link href={homeHref}>صفحه اصلی</Link>{breadcrumb ? ` / ${breadcrumb}` : ''}
          </span>
          <span className="ptopbar-spacer" />
          {userName && <span className="ptopbar-user" title={userName}>نام کاربر : <b>{userName}</b></span>}
          <span className="ptopbar-spacer" />
          {action && <span className="no-print ptopbar-action">{action}</span>}
          <span className="no-print"><NotificationBell realm={realm} /></span>
          <span className="no-print"><WallpaperPicker /></span>
          <span className="no-print"><ThemeToggle /></span>
          {/* The organisation's logo at the far end of the bar (like the insurer's own portal) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl || '/brand/damuon-mark.webp'} alt={brand?.name ?? ''} className="ptopbar-logo no-print" />
        </header>

        <div className="pshell-content">
          <div className="pshell-wrap fade-up">{children}</div>
        </div>
      </div>

      {/* ── Navy sidebar (right, collapsible) ── */}
      <aside className={`psidebar no-print ${rail ? 'is-rail' : ''} ${open ? 'is-open' : ''}`}>
        <div className="psidebar-logo">
          {/* Just the logo itself — no tile or circle behind it */}
          <Link href={homeHref} className="circle" aria-label="خانه">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl || '/brand/damuon-mark.webp'} alt="" className="psidebar-mark" />
          </Link>
          <div className="psidebar-name">{brand?.name || 'دامون'}</div>
          {card ? (
            <div className="psidebar-sub psidebar-card">{card.broker}{card.period && <><br />{card.period}</>}</div>
          ) : subtitle && <div className="psidebar-sub">{subtitle}</div>}
          {info && <div className="psidebar-panel">{info.label}</div>}
        </div>

        <button className="psidebar-toggle" onClick={toggleRail}>
          <span className="lbl">بستن منو</span>
          <Icon path={rail ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
        </button>

        <nav className="psidebar-nav">
          {sectionLabel && !nav.some((n) => n.group) && ( /* grouped menus carry their own headings */
            <div className="pnav-section">
              <span className="ico"><Icon path="M4 6h16M4 12h16M4 18h16" /></span>
              <span className="lbl">{sectionLabel}</span>
            </div>
          )}
          {visibleNav.map((n, i) => {
            const active = pathname === n.href.split('?')[0] && !n.href.includes('?');
            const heading = n.group && n.group !== visibleNav[i - 1]?.group
              ? <div key={`g-${n.group}`} className="pnav-group"><span className="lbl">{n.group}</span></div>
              : null;
            const item = n.special === 'password' ? (
              <button key={n.href} type="button" onClick={() => setShowPw(true)} className="pnav-item" title={n.label}>
                <span className="ico">{n.icon}</span>
                <span className="lbl">{n.label}</span>
              </button>
            ) : (
              <Link key={n.href} href={n.href} className={`pnav-item ${active ? 'is-active' : ''}`} title={n.label}>
                <span className="ico">{n.icon}</span>
                <span className="lbl">{n.label}</span>
              </Link>
            );
            return heading ? [heading, item] : item;
          })}
        </nav>

        <div className="psidebar-foot">
          {!nav.some((n) => n.special === 'password' || n.href.endsWith('/password')) && (
            <button onClick={() => setShowPw(true)} className="pnav-item" title="تغییر رمز عبور">
              <span className="ico"><Icon path={PW_ICON} /></span>
              <span className="lbl">تغییر رمز عبور</span>
            </button>
          )}
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
