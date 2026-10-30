'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, getTenantSlug, setTenantSlug, setToken } from '../../lib/client';
import { OrgPanel, PANELS, rememberPanel } from '../../lib/panel';

const INSURER_INFO = { label: 'پنل بیمه‌گر', accent: '#334155', title: 'ورود بیمه‌گر', subtitle: 'شعبه، مدیریت ستاد و شورای فنی' };
import { applyTheme, TenantTheme } from '../../lib/theme';
import { AuthCard, LoginNav } from './auth-card';
import { ErrorBox, Field } from './ui';

interface OrgBrand { slug: string; name: string; hasLogo: boolean; theme: TenantTheme | null }
interface Org { slug: string; name: string; kind?: string }

/**
 * Org login pages: «ورود کارگزاری» (/org/login, kind BROKER) and «ورود بیمه‌گر» (/insurer/login, kind
 * INSURER) — one page for the insurer's شعبه, ستاد and شورای فنی; the account decides which panel opens.
 * Only matching organizations are offered (brokerages / insurers).
 */
export function OrgLoginPage({ kind }: { kind: 'BROKER' | 'INSURER' }) {
  const router = useRouter();
  const info = kind === 'BROKER' ? PANELS.BROKER : INSURER_INFO;
  const wantKind = kind;
  const panel: OrgPanel | undefined = kind === 'BROKER' ? 'BROKER' : undefined; // insurer: the account's own desk
  const [tenantSlug, setSlug] = useState('');
  const [fixedOrg, setFixedOrg] = useState(false); // opened via ?org=… (an insurer's own login link)
  const [brand, setBrand] = useState<OrgBrand | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [wrongPanel, setWrongPanel] = useState<OrgPanel | null>(null);
  const [loading, setLoading] = useState(false);
  const [totp, setTotp] = useState<string | null>(null); // null = not asked; '' = asked, typing
  // Organizations to pick from (a dropdown instead of typing the شناسه). Temporary: once every org has
  // its own domain / subdomain the login won't need a choice at all. null = list unavailable → type it.
  const [orgs, setOrgs] = useState<Org[] | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('org');
    fetch(`${client.base}/customer/orgs`).then((r) => (r.ok ? r.json() : null)).then((l: Org[] | null) => {
      const list = Array.isArray(l) ? l.filter((o) => !o.kind || o.kind === wantKind) : [];
      setOrgs(list.length ? list : null);
      if (fromUrl) { setSlug(fromUrl.trim().toLowerCase()); setFixedOrg(true); return; }
      // After logout, come back to the same organization — if it belongs to this kind of panel.
      const last = getTenantSlug();
      setSlug(list.some((o) => o.slug === last) ? last : list[0]?.slug ?? last);
    }).catch(() => { setOrgs(null); setSlug(fromUrl?.trim().toLowerCase() || getTenantSlug()); if (fromUrl) setFixedOrg(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Look up the chosen organization's branding (debounced) and theme the page with it.
  useEffect(() => {
    const slug = tenantSlug.trim().toLowerCase();
    if (!slug) return;
    let active = true;
    const t = setTimeout(() => {
      fetch(`${client.base}/tenant/branding`, { headers: { 'x-tenant-slug': slug } })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (!active) return;
          const next = b ? { slug, name: b.name, hasLogo: !!b.logoUrl, theme: b.theme ?? null } : null;
          setBrand(next);
          applyTheme(next?.theme ?? null);
        })
        .catch(() => { if (active) { setBrand(null); applyTheme(null); } });
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [tenantSlug]);

  const submit = async () => {
    setError(''); setWrongPanel(null); setLoading(true);
    try {
      setTenantSlug(tenantSlug);
      const code = totp ? totp.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim() : undefined;
      const r = await client.post<{ token: string; mfaSetupRequired?: boolean; panel?: OrgPanel }>('/auth/org/login', { tenantSlug, username, password, ...(panel ? { panel } : {}), ...(code ? { totp: code } : {}) });
      setToken('org', r.token);
      rememberPanel('org', r.panel ?? panel ?? 'HQ');
      router.push(r.mfaSetupRequired ? '/org/security?required=1' : '/org/welcome');
    } catch (e: any) {
      // Two-step login: the password was right; now the authenticator code.
      if (e.code === 'MFA_REQUIRED') { setTotp(''); setError(''); }
      else {
        setError(e.message);
        if (e.code === 'MFA_INVALID') setTotp('');
        if (e.code === 'WRONG_PANEL') setWrongPanel((e.panel as OrgPanel) || null);
      }
    } finally { setLoading(false); }
  };

  const fields = (
    <>
      <div className="panel-tag" style={{ ['--panel-accent' as any]: info.accent }}>{info.label}</div>
      <ErrorBox message={error} />
      {wrongPanel && <Link href={PANELS[wrongPanel].login} className="btn btn-ghost btn-sm w-full">رفتن به صفحهٔ ورود «{PANELS[wrongPanel].label}»</Link>}
      {fixedOrg && brand ? (
        <div className="text-sm flex items-center justify-between rounded-full px-4 py-2" style={{ background: 'var(--brand-soft)' }}>
          <span>سازمان: <b>{brand.name}</b></span>
          <button type="button" className="text-xs underline" onClick={() => setFixedOrg(false)}>تغییر</button>
        </div>
      ) : (
        <Field label={kind === 'BROKER' ? 'کارگزاری' : 'بیمه‌گر'}>
          {orgs ? (
            <select className="input" value={tenantSlug} onChange={(e) => setSlug(e.target.value)}>
              {!orgs.some((o) => o.slug === tenantSlug) && <option value={tenantSlug}>{tenantSlug || '— انتخاب سازمان —'}</option>}
              {orgs.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}
            </select>
          ) : (
            <input className="input" value={tenantSlug} onChange={(e) => setSlug(e.target.value)} placeholder="damuon" style={{ direction: 'ltr', textAlign: 'right' }} />
          )}
        </Field>
      )}
      <Field label="نام کاربری"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
      <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
      {totp !== null && (
        <Field label="کد ورود دومرحله‌ای (برنامهٔ احراز هویت گوشی)">
          <input className="input latin-digits" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
            style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '0.3em' }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
      )}
    </>
  );

  // An insurer with its own login look (Sinad-style): full-page backdrop, white card, its logo.
  if (brand?.theme?.loginBg && kind === 'INSURER') {
    const logo = brand.hasLogo ? `${client.base}/tenant/assets/logo?tenant=${brand.slug}` : null;
    return (
      <div className="tlogin-bg flex items-center justify-center overflow-y-auto p-4" style={{ background: brand.theme.loginBg, zIndex: 50 }}>
        <div className="w-full max-w-md">
          <div className="tlogin-card space-y-4">
            <div className="flex flex-col items-center text-center gap-2 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo && <img src={logo} alt={brand.name} style={{ height: 110, width: 'auto', maxWidth: 220, objectFit: 'contain' }} />}
              <div className="font-bold" style={{ color: brand.theme.title || 'var(--brand)' }}>{brand.name}</div>
              <div className="text-sm font-extrabold">سامانهٔ رسیدگی به پرونده‌های خسارت عمر و حادثه</div>
              <div className="text-xs" style={{ color: '#6b7280' }}>{info.subtitle}</div>
            </div>
            {fields}
            <button onClick={submit} disabled={loading || !username || !password} className="tlogin-btn" style={{ background: brand.theme.loginButton || 'var(--brand)' }}>
              {loading ? '…' : `ورود به ${info.label}`}
            </button>
          </div>
          <LoginNav onDark />
          <div className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.85)' }}>با همکاری کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>
        </div>
      </div>
    );
  }

  return (
    <AuthCard title={info.title} subtitle={info.subtitle} bg={{ light: ['org-day-1', 'org-day-2'], dark: ['org-night-1'] }}>
      <div className="space-y-4">
        {fields}
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
      </div>
    </AuthCard>
  );
}
