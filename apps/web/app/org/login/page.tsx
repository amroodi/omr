'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { client, getTenantSlug, setTenantSlug, setToken } from '../../../lib/client';
import { applyTheme, TenantTheme } from '../../../lib/theme';
import { AuthCard, LoginNav } from '../../components/auth-card';
import { ErrorBox, Field } from '../../components/ui';

interface OrgBrand { slug: string; name: string; hasLogo: boolean; theme: TenantTheme | null }

export default function OrgLogin() {
  const router = useRouter();
  const [tenantSlug, setSlug] = useState('damuon');
  const [fixedOrg, setFixedOrg] = useState(false); // opened via ?org=… (an insurer's own login link)
  const [brand, setBrand] = useState<OrgBrand | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const org = new URLSearchParams(window.location.search).get('org');
    if (org) { setSlug(org.trim().toLowerCase()); setFixedOrg(true); }
    else setSlug(getTenantSlug()); // after logout, come back to the same organization's login
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
    setError(''); setLoading(true);
    try {
      setTenantSlug(tenantSlug);
      const r = await client.post<{ token: string }>('/auth/org/login', { tenantSlug, username, password });
      setToken('org', r.token);
      router.push('/org/welcome');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  const fields = (
    <>
      <ErrorBox message={error} />
      {fixedOrg && brand ? (
        <div className="text-sm flex items-center justify-between rounded-full px-4 py-2" style={{ background: 'var(--brand-soft)' }}>
          <span>سازمان: <b>{brand.name}</b></span>
          <button type="button" className="text-xs underline" onClick={() => setFixedOrg(false)}>تغییر</button>
        </div>
      ) : (
        <Field label="شناسه سازمان"><input className="input" value={tenantSlug} onChange={(e) => setSlug(e.target.value)} placeholder="damuon" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      )}
      <Field label="نام کاربری"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
      <Field label="رمز عبور"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
    </>
  );

  // An insurer with its own login look (Sinad-style): full-page backdrop, white card, its logo.
  if (brand?.theme?.loginBg) {
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
              <div className="text-xs" style={{ color: '#6b7280' }}>ورود کارکنان شعبه، مدیریت ستاد و شورای فنی</div>
            </div>
            {fields}
            <button onClick={submit} disabled={loading || !username || !password} className="tlogin-btn" style={{ background: brand.theme.loginButton || 'var(--brand)' }}>
              {loading ? '…' : 'ورود به سامانه'}
            </button>
          </div>
          <LoginNav onDark />
          <div className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.85)' }}>با همکاری کارگزاری رسمی بیمه مستقیم برخط آتیه اندیشان دامون</div>
        </div>
      </div>
    );
  }

  return (
    <AuthCard title="ورود سازمان" subtitle="پنل مدیریت پرونده‌های سازمان" bg={{ light: ['org-day-1', 'org-day-2'], dark: ['org-night-1'] }}>
      <div className="space-y-4">
        {fields}
        <button onClick={submit} disabled={loading || !username || !password} className="btn btn-primary w-full">{loading ? '…' : 'ورود'}</button>
      </div>
    </AuthCard>
  );
}
