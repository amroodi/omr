'use client';
import { useEffect, useState } from 'react';
import { OnProgress, UploadButton } from './upload';
import { Field } from './ui';

type Theme = Record<string, string>;
export interface Design {
  id: string; name: string; slug: string; kind: string;
  theme: Theme | null;
  panelThemes: Record<string, Theme>;
  panels: { key: string; label: string; hasLogo: boolean }[];
  hasLogo: boolean;
  presets: { key: string; label: string; theme: Theme }[];
}

/** What the designer needs from its page: the org admin's own endpoints, or the super admin's for any org. */
export interface DesignApi {
  load: () => Promise<Design>;
  save: (body: { theme: Theme | null; panelThemes: Record<string, Theme> }) => Promise<Design>;
  uploadLogo: (file: File, panel: string | null, onProgress: OnProgress) => Promise<Design>;
  clearLogo: (panel: string) => Promise<Design>;
  logoSrc: (panel: string | null) => Promise<string | null>; // object URL for the preview
}

const FIELDS: [string, string][] = [
  ['brand', 'رنگ اصلی (دکمه‌ها و برجسته‌ها)'],
  ['title', 'رنگ عنوان صفحه'],
  ['sidebar', 'منوی کناری'],
  ['sidebarDeep', 'منوی کناری — ردیف فعال'],
  ['canvas', 'پس‌زمینهٔ صفحه'],
  ['loginButton', 'دکمهٔ ورود'],
];
// The default design's colours — what an empty token falls back to (globals.css).
const DEFAULTS: Theme = { brand: '#ff9500', title: '#ff9500', sidebar: '#2b3a4f', sidebarDeep: '#243343', canvas: '#e9edf2', loginButton: '#ff9500' };

/**
 * «طراحی ظاهر»: the organization's theme (the default of every panel) and each panel's own theme and
 * logo, with a live preview. Empty colours inherit: panel → organization → the default design.
 */
export function ThemeDesigner({ api }: { api: DesignApi }) {
  const [d, setD] = useState<Design | null>(null);
  const [tab, setTab] = useState<string>('ORG'); // 'ORG' | panel key
  const [org, setOrg] = useState<Theme>({});
  const [panels, setPanels] = useState<Record<string, Theme>>({});
  const [logo, setLogo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (x: Design) => { setD(x); setOrg(x.theme ?? {}); setPanels(x.panelThemes ?? {}); };
  useEffect(() => { api.load().then(apply).catch((e) => setMsg({ t: 'err', m: e.message })); /* eslint-disable-next-line */ }, []);
  // Preview logo of the selected tab (a panel without its own shows the organization's).
  useEffect(() => {
    let url: string | null = null; let active = true;
    api.logoSrc(tab === 'ORG' ? null : tab).then((u) => { if (active) { url = u; setLogo(u); } else if (u) URL.revokeObjectURL(u); }).catch(() => active && setLogo(null));
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, d]);

  if (!d) return msg ? <div className="alert-error">{msg.m}</div> : null;
  const isOrg = tab === 'ORG';
  const own: Theme = isOrg ? org : panels[tab] ?? {};
  const setOwn = (t: Theme) => (isOrg ? setOrg(t) : setPanels({ ...panels, [tab]: t }));
  const effective: Theme = { ...DEFAULTS, ...org, ...(isOrg ? {} : panels[tab] ?? {}) };
  const panel = d.panels.find((p) => p.key === tab);

  const run = async (fn: () => Promise<Design>, ok: string) => {
    setMsg(null); setBusy(true);
    try { apply(await fn()); setMsg({ t: 'ok', m: ok }); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const save = () => run(() => api.save({ theme: Object.keys(org).length ? org : null, panelThemes: panels }), 'طراحی ظاهر ذخیره شد');

  return (
    <div className="space-y-4">
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTab('ORG')} className={`btn btn-sm ${isOrg ? 'btn-primary' : 'btn-ghost'}`}>سازمان (پیش‌فرض همهٔ پنل‌ها)</button>
        {d.panels.map((p) => <button key={p.key} onClick={() => setTab(p.key)} className={`btn btn-sm ${tab === p.key ? 'btn-primary' : 'btn-ghost'}`}>{p.label}</button>)}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {isOrg ? 'رنگ‌های سازمان؛ هر پنلی که رنگ خودش را ندارد همین‌ها را می‌گیرد. خالی = طرح پیش‌فرض.' : `رنگ‌های «${panel?.label}». رنگ خالی از رنگ‌های سازمان گرفته می‌شود.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {d.presets.map((p) => <button key={p.key} onClick={() => setOwn({ ...p.theme })} className="btn btn-ghost btn-sm" style={{ borderInlineStart: `6px solid ${p.theme.brand}` }}>قالب {p.label}</button>)}
            <button onClick={() => setOwn({})} className="btn btn-ghost btn-sm">{isOrg ? 'طرح پیش‌فرض' : 'همان رنگ‌های سازمان'}</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <input type="color" value={own[k] || effective[k] || '#ffffff'} onChange={(e) => setOwn({ ...own, [k]: e.target.value })} style={{ width: 34, height: 28, border: 0, background: 'none' }} />
                <span className="flex-1">{label}{!own[k] && <span style={{ color: 'var(--muted)' }}> — {isOrg ? 'پیش‌فرض' : 'از سازمان'}</span>}</span>
                {own[k] && <button className="text-[11px]" style={{ color: 'var(--muted)' }} onClick={() => { const n = { ...own }; delete n[k]; setOwn(n); }}>حذف</button>}
              </label>
            ))}
          </div>
          {isOrg && (
            <Field label="پس‌زمینهٔ صفحهٔ ورود (رنگ یا linear-gradient)">
              <input className="input" value={org.loginBg || ''} onChange={(e) => setOrg({ ...org, loginBg: e.target.value })} placeholder="linear-gradient(120deg, #4458d0 0%, #c150c1 100%)" style={{ direction: 'ltr', fontSize: 12 }} />
            </Field>
          )}

          <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-2)' }}>
            <div className="text-sm font-semibold">لوگو</div>
            <div className="flex flex-wrap items-center gap-2">
              <UploadButton accept="image/png,image/jpeg,image/svg+xml,image/webp" maxMB={3} title={isOrg ? 'لوگوی سازمان' : `لوگوی «${panel?.label}»`}
                onUpload={async (f, onP) => { await run(() => api.uploadLogo(f, isOrg ? null : tab, onP), 'لوگو بارگذاری شد'); }}>
                {isOrg ? (d.hasLogo ? 'تغییر لوگوی سازمان' : 'بارگذاری لوگوی سازمان') : panel?.hasLogo ? 'تغییر لوگوی این پنل' : 'لوگوی جداگانه برای این پنل'}
              </UploadButton>
              {!isOrg && panel?.hasLogo && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.clearLogo(tab), 'این پنل لوگوی سازمان را نشان می‌دهد')}>استفاده از لوگوی سازمان</button>}
            </div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{isOrg ? 'همهٔ پنل‌ها همین لوگو را نشان می‌دهند، مگر پنلی که لوگوی جداگانه دارد.' : panel?.hasLogo ? 'این پنل لوگوی خودش را دارد.' : 'این پنل لوگوی سازمان را نشان می‌دهد.'}</p>
          </div>
          <button onClick={save} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'ذخیرهٔ طراحی ظاهر'}</button>
        </div>

        <Preview theme={effective} logo={logo} name={d.name} label={isOrg ? 'همهٔ پنل‌ها' : panel?.label ?? ''} />
      </div>
    </div>
  );
}

/** A small live mock of a panel: top bar, sidebar with an active row, a card and a button. */
function Preview({ theme, logo, name, label }: { theme: Theme; logo: string | null; name: string; label: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>پیش‌نمایش — {label}</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', display: 'flex', height: 230, background: theme.canvas }} dir="rtl">
        <div style={{ width: 92, background: theme.sidebar, color: '#fff', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt="" style={{ width: 46, height: 46, objectFit: 'contain' }} /> : <div style={{ width: 46, height: 46, borderRadius: 999, background: 'rgba(255,255,255,.15)' }} />}
          <div style={{ fontSize: 9, textAlign: 'center', lineHeight: 1.3 }}>{name}</div>
          <div style={{ width: '100%', height: 14, borderRadius: 4, background: theme.sidebarDeep }} />
          <div style={{ width: '100%', height: 10, borderRadius: 4, background: 'rgba(255,255,255,.12)' }} />
          <div style={{ width: '100%', height: 10, borderRadius: 4, background: 'rgba(255,255,255,.12)' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 34, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, fontWeight: 800, color: theme.title }}>میز کار</div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: '#fff', borderRadius: 8, height: 70, border: '1px solid #e5e7eb', padding: 8, fontSize: 10, color: '#334155' }}>کارت نمونه</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ background: theme.brand, color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700 }}>دکمهٔ اصلی</span>
              <span style={{ background: theme.loginButton, color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700 }}>ورود</span>
            </div>
          </div>
        </div>
      </div>
      {theme.loginBg && <div className="rounded-lg h-8" style={{ background: theme.loginBg }} title="پس‌زمینهٔ صفحهٔ ورود" />}
    </div>
  );
}
