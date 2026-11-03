'use client';
import { useEffect, useState } from 'react';
import { client, setTenantSlug, setToken } from '../../lib/client';
import { PanelKey, PANELS, rememberMode, rememberPanel } from '../../lib/panel';
import { ErrorBox, Field } from './ui';

interface Targets {
  tenant: { id: string; kind: string; name: string; slug: string };
  users: { id: string; name: string; username: string; role: string | null; panel: PanelKey; isActive: boolean }[];
  companies: { id: string; name: string; isActive: boolean }[];
  representatives: { id: string; name: string; company: string | null; isActive: boolean }[];
}
type Kind = 'ORG' | 'COMPANY' | 'REPRESENTATIVE';

/**
 * Super Admin «ورود به پنل»: open this organization's panel as one of its operators, a بیمه‌گزار company or a
 * نماینده, in a new tab — to help them or step in. A fresh authenticator code each time; 30 minutes; every
 * action is recorded under the Super Admin and texted to the Super Admin's own numbers.
 */
export function AssistCard({ tenantId }: { tenantId: string }) {
  const [t, setT] = useState<Targets | null>(null);
  const [kind, setKind] = useState<Kind>('ORG');
  const [pick, setPick] = useState('');
  const [mode, setMode] = useState<'PROCESS' | 'ENTRY'>('PROCESS');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get<Targets>(`/platform/assist/targets?tenantId=${tenantId}`, 'super').then(setT).catch((e) => setError(e.message)); }, [tenantId]);
  useEffect(() => { setPick(''); }, [kind]);
  if (!t) return error ? <ErrorBox message={error} /> : null;

  const broker = t.tenant.kind === 'BROKER';
  const options = kind === 'ORG'
    ? t.users.map((u) => ({ id: u.id, label: `${u.name} (${u.username})${u.role ? ` — ${u.role}` : ''} — ${PANELS[u.panel]?.label ?? u.panel}${u.isActive ? '' : ' — غیرفعال'}` }))
    : kind === 'COMPANY' ? t.companies.map((c) => ({ id: c.id, label: `${c.name}${c.isActive ? '' : ' — غیرفعال'}` }))
    : t.representatives.map((r) => ({ id: r.id, label: `${r.name}${r.company ? ` — ${r.company}` : ''}${r.isActive ? '' : ' — غیرفعال'}` }));
  const digits = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');

  const enter = async () => {
    setError(''); setBusy(true);
    // Open the tab now (a click) so the browser doesn't block it; it gets its address once the server agrees.
    const tab = window.open('', '_blank');
    try {
      const r = await client.post<{ token: string; realm: 'org' | 'customer'; tenantSlug: string; home: string; mode: 'ENTRY' | 'PROCESS' }>('/platform/assist', { tenantId, target: kind, id: pick, totp: digits(totp), ...(kind === 'ORG' ? { mode } : {}) }, 'super');
      setTenantSlug(r.tenantSlug);
      setToken(r.realm, r.token);
      if (r.realm === 'org') { const u = t.users.find((x) => x.id === pick); if (u) rememberPanel('org', u.panel); rememberMode(r.mode); }
      else rememberPanel('customer', kind === 'REPRESENTATIVE' ? 'REPRESENTATIVE' : 'COMPANY');
      setTotp('');
      if (tab) tab.location.href = r.home; else window.location.href = r.home;
    } catch (e: any) { tab?.close(); setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        پنل این سازمان در زبانهٔ تازه باز می‌شود؛ می‌توانید هم ثبت پرونده و هم رسیدگی کنید. هر بار کد برنامهٔ احراز هویت لازم است، ورود ۳۰ دقیقه
        اعتبار دارد، همهٔ کارها به نام «مدیر سامانه» ثبت می‌شود و پیامک به شماره‌های امنیت ورود شما می‌رود. رمز عبور و ورود دومرحله‌ای آن کاربر تغییر نمی‌کند.
      </p>
      <ErrorBox message={error} />
      <div className="entry-tabs" role="tablist" style={{ maxWidth: 420 }}>
        <button type="button" role="tab" aria-selected={kind === 'ORG'} className={kind === 'ORG' ? 'is-on' : ''} onClick={() => setKind('ORG')}>کارکنان</button>
        {broker && <button type="button" role="tab" aria-selected={kind === 'COMPANY'} className={kind === 'COMPANY' ? 'is-on' : ''} onClick={() => setKind('COMPANY')}>بیمه‌گزار</button>}
        {broker && <button type="button" role="tab" aria-selected={kind === 'REPRESENTATIVE'} className={kind === 'REPRESENTATIVE' ? 'is-on' : ''} onClick={() => setKind('REPRESENTATIVE')}>نماینده</button>}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label={kind === 'ORG' ? 'کاربر' : kind === 'COMPANY' ? 'شرکت بیمه‌گزار' : 'نماینده'}>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
        {kind === 'ORG' && broker && (
          <Field label="نمای پنل">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'PROCESS' | 'ENTRY')}>
              <option value="PROCESS">رسیدگی (پنل ۲)</option>
              <option value="ENTRY">ورود داده (پنل ۱)</option>
            </select>
          </Field>
        )}
        <Field label="کد برنامهٔ احراز هویت شما">
          <input className="input latin-digits" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" maxLength={6} autoComplete="one-time-code"
            style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '0.3em' }} onKeyDown={(e) => e.key === 'Enter' && pick && digits(totp).length === 6 && enter()} />
        </Field>
      </div>
      <button onClick={enter} disabled={busy || !pick || digits(totp).length !== 6} className="btn btn-primary btn-sm">{busy ? '…' : 'ورود به پنل (۳۰ دقیقه)'}</button>
    </div>
  );
}
