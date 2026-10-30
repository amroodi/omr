'use client';
import { useEffect, useState } from 'react';
import { OnProgress, UploadButton } from '../../components/upload';
import { client, getTenantSlug } from '../../../lib/client';
import { lastPanel } from '../../../lib/panel';
import { Design, DesignApi, ThemeDesigner } from '../../components/ThemeDesigner';
import { applyTheme } from '../../../lib/theme';
import { Shell } from '../../components/Shell';
import { CLAIM_TYPE_LABELS, ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

const TABS = [
  ['branding', 'برندینگ و تنظیمات'],
  ['sms', 'درگاه پیامک'],
  ['branches', 'شعب'],
  ['levels', 'سطوح تایید و سقف اختیار'],
  ['docs', 'مدارک مورد نیاز'],
  ['fields', 'فیلدهای پرونده'],
  ['notice', 'اعلام خسارت'],
] as const;

export default function Settings() {
  const [tab, setTab] = useState<string>('branding');
  return (
    <Shell title="تنظیمات سازمان" subtitle="پیکربندی سازمان شما؛ هر تغییر بلافاصله اعمال می‌شود" nav={ORG_NAV} realm="org">
      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="btn btn-sm" style={tab === k ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>{l}</button>
        ))}
      </div>
      {tab === 'branding' && <BrandingTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'branches' && <BranchesTab />}
      {tab === 'levels' && <LevelsTab />}
      {tab === 'docs' && <DocsTab />}
      {tab === 'fields' && <FieldsTab />}
      {tab === 'notice' && <NoticeTab />}
    </Shell>
  );
}

interface NoticeSourceRow { key: string; label: string; allowed: { key: string; label: string }[]; rule: { enabled: boolean; targets: string[]; default: string } }

/**
 * «اعلام خسارت»: who may report a claim from which panel, and on which desk the case starts. A
 * کارگزاری decides for its بیمه‌گزاران, نمایندگان and operators; a بیمه‌گر for its desks and نمایندگان.
 */
function NoticeTab() {
  const [d, setD] = useState<{ kind: string; sources: NoticeSourceRow[] } | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.get<any>('/claims/notice-rules', 'org').then(setD).catch((e) => setMsg({ t: 'err', m: e.message })); }, []);
  const upd = (key: string, p: Partial<NoticeSourceRow['rule']>) => setD((x) => x && ({ ...x, sources: x.sources.map((r) => {
    if (r.key !== key) return r;
    const rule = { ...r.rule, ...p };
    if (!rule.targets.includes(rule.default)) rule.default = rule.targets[0] ?? r.rule.default;
    return { ...r, rule };
  }) }));
  const save = async () => {
    if (!d) return;
    setMsg(null); setBusy(true);
    try {
      const body = Object.fromEntries(d.sources.map((r) => [r.key, r.rule]));
      setD(await client.put<any>('/claims/notice-rules', body, 'org'));
      setMsg({ t: 'ok', m: 'تنظیمات اعلام خسارت ذخیره شد' });
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  if (!d) return msg ? <div className="alert-error">{msg.m}</div> : null;
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-4 text-sm" style={{ color: 'var(--muted)' }}>
        {d.kind === 'INSURER'
          ? 'مشخص کنید کاربران شعبه، ستاد، شورای فنی و نمایندگان می‌توانند پرونده اعلام کنند یا نه، و پرونده به کدام مرحله برود. اعلام خسارت نماینده باید هم در تنظیمات کارگزاری و هم در تنظیمات بیمه‌گر مجاز باشد.'
          : 'مشخص کنید بیمه‌گزاران، نمایندگان و کاربران کارگزاری می‌توانند پرونده اعلام کنند یا نه، و پرونده پس از ثبت به کدام مرحله برود.'}
      </div>
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      {d.sources.map((r) => (
        <div key={r.key} className="card p-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={r.rule.enabled} onChange={(e) => upd(r.key, { enabled: e.target.checked })} />
            <span className="font-bold">اعلام خسارت توسط {r.label}</span>
            {!r.rule.enabled && <span className="badge badge-neutral">غیرفعال</span>}
          </label>
          <fieldset disabled={!r.rule.enabled} style={{ opacity: r.rule.enabled ? 1 : 0.5 }} className="space-y-2">
            <legend className="text-xs mb-1" style={{ color: 'var(--muted)' }}>پرونده می‌تواند به این مرحله‌ها ارسال شود:</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {r.allowed.map((t) => (
                <label key={t.key} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={r.rule.targets.includes(t.key)}
                    onChange={(e) => upd(r.key, { targets: e.target.checked ? r.allowed.map((a) => a.key).filter((k) => k === t.key || r.rule.targets.includes(k)) : r.rule.targets.filter((k) => k !== t.key) })} />
                  {t.label}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--muted)' }}>مرحلهٔ پیش‌فرض:</span>
              <select className="input" style={{ maxWidth: 260 }} value={r.rule.default} onChange={(e) => upd(r.key, { default: e.target.value })}>
                {r.allowed.filter((t) => r.rule.targets.includes(t.key)).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </fieldset>
        </div>
      ))}
      <button onClick={save} disabled={busy || d.sources.some((r) => r.rule.enabled && r.rule.targets.length === 0)} className="btn btn-primary btn-sm">{busy ? '…' : 'ذخیره'}</button>
    </div>
  );
}

/** The org admin's own design endpoints (the super admin's are in /admin/orgs/[id]). */
const ORG_DESIGN_API: DesignApi = {
  load: () => client.get<Design>('/tenant/design', 'org'),
  save: async (body) => { const d = await client.put<Design>('/tenant/design', body, 'org'); reapplyTheme(); return d; },
  uploadLogo: (file, panel, onP) => { const fd = new FormData(); fd.append('file', file); return client.upload<Design>(`/tenant/design/logo${panel ? `?panel=${panel}` : ''}`, fd, 'org', onP); },
  clearLogo: (panel) => client.del<Design>(`/tenant/design/logo?panel=${panel}`, 'org'),
  logoSrc: async (panel) => {
    const r = await fetch(`${client.base}/tenant/assets/logo?tenant=${getTenantSlug()}${panel ? `&panel=${panel}` : ''}&v=${Date.now()}`);
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  },
};
/** After saving, show this panel's new look right away. */
function reapplyTheme() {
  const panel = lastPanel('org');
  client.get<{ theme?: Record<string, string> | null }>(`/tenant/branding${panel ? `?panel=${panel}` : ''}`, 'org').then((b) => applyTheme(b.theme ?? null)).catch(() => {});
}

function BrandingTab() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const load = () => client.get<any>('/tenant/settings', 'org').then(setS).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try { await client.patch('/tenant/settings', { name: s.name, contactHeader: s.contactHeader, noticeDays: Number(s.noticeDays), lateNoticeWarning: s.lateNoticeWarning !== false, rejectReasons: String(s.rejectReasonsText ?? (s.rejectReasons ?? []).join('\n')).split('\n').map((x: string) => x.trim()).filter(Boolean), reminderSms: !!s.reminderSms, requireMfa: !!s.requireMfa, ...(s.kind === 'INSURER' ? { hqCeiling: String(s.hqCeiling ?? '').replace(/[^\d]/g, '') || null } : {}) }, 'org'); setMsg({ t: 'ok', m: 'ذخیره شد' }); load(); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const uploadLogo = async (file: File, onProgress: OnProgress) => {
    const fd = new FormData(); fd.append('file', file);
    await client.upload('/tenant/assets/logo', fd, 'org', onProgress);
    setMsg({ t: 'ok', m: 'لوگو بارگذاری شد' }); load();
  };
  if (!s) return null;
  return (
    <div className="card p-5 max-w-lg space-y-3">
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <Field label="نام سازمان"><input className="input" value={s.name || ''} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
      <Field label="سربرگ تماس (در خروجی‌ها)"><input className="input" value={s.contactHeader || ''} onChange={(e) => setS({ ...s, contactHeader: e.target.value })} /></Field>
      {s.kind === 'INSURER' && (
        <Field label="سقف اختیار پرداخت مدیریت ستاد (ریال) — خالی = نامحدود؛ بالاتر از آن ارجاع به شورای فنی الزامی است">
          <input className="input" inputMode="numeric" value={s.hqCeiling ?? ''} onChange={(e) => setS({ ...s, hqCeiling: e.target.value.replace(/[^\d]/g, '') })} style={{ direction: 'ltr', textAlign: 'right' }} placeholder="مثلاً 5000000000" />
        </Field>
      )}
      <Field label="مهلت اعلام خسارت (روز)"><input className="input" type="number" value={s.noticeDays ?? 30} onChange={(e) => setS({ ...s, noticeDays: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={s.lateNoticeWarning !== false} onChange={(e) => setS({ ...s, lateNoticeWarning: e.target.checked })} />
        <span>نمایش هشدار «خارج از مهلت مقرر» روی پرونده‌ها</span>
      </label>
      <Field label="دلایل رد مدارک — هر دلیل در یک خط (هنگام رد مدرک به‌صورت فهرست انتخابی نمایش داده می‌شود)">
        <textarea className="input" rows={5} value={s.rejectReasonsText ?? (s.rejectReasons ?? []).join('\n')} onChange={(e) => setS({ ...s, rejectReasonsText: e.target.value })}
          placeholder={'مثلاً:\nتصویر ناخوانا است\nمهر و امضای بیمه‌گزار ندارد\nبرابر با اصل نشده است'} />
      </Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={!!s.reminderSms} onChange={(e) => setS({ ...s, reminderSms: e.target.checked })} />
        <span>ارسال پیامک یادآور به کاربران (علاوه بر یادآور در سامانه)</span>
      </label>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-1" checked={!!s.requireMfa} onChange={(e) => setS({ ...s, requireMfa: e.target.checked })} />
        <span>ورود دومرحله‌ای برای همهٔ کاربران سازمان الزامی باشد<span className="block text-xs" style={{ color: 'var(--muted)' }}>کاربرانی که هنوز راه‌اندازی نکرده‌اند در ورود بعدی ابتدا آن را راه‌اندازی می‌کنند.</span></span>
      </label>
      <div className="flex gap-2 items-center">
        <UploadButton onUpload={uploadLogo} accept="image/*" maxMB={3} title={s.hasLogo ? 'تغییر لوگو' : 'بارگذاری لوگو'}>{s.hasLogo ? 'تغییر لوگو' : 'بارگذاری لوگو'}</UploadButton>
        {s.hasLogo && <span className="badge badge-success">لوگو تنظیم شده</span>}
      </div>
      <button onClick={save} className="btn btn-primary btn-sm">ذخیره</button>
      <div className="border-t pt-4 mt-2" style={{ borderColor: 'var(--border)' }}>
        <h3 className="font-bold text-sm mb-2">طراحی ظاهر پنل‌ها</h3>
        <ThemeDesigner api={ORG_DESIGN_API} />
      </div>
    </div>
  );
}

const DRIVER_LABELS: Record<string, string> = {
  console: 'کنسول (آزمایشی — بدون ارسال واقعی)', magfa: 'مگفا — HTTP V2', 'magfa-soap': 'مگفا — SOAP V2',
  kavenegar: 'کاوه‌نگار', ghasedak: 'قاصدک', smsir: 'SMS.ir', melipayamak: 'ملی‌پیامک',
};
// Which fields each provider needs, to show only the relevant inputs.
const DRIVER_FIELDS: Record<string, string[]> = {
  console: ['sender', 'otpTemplate'],
  magfa: ['username', 'password', 'domain', 'sender', 'otpTemplate'],
  'magfa-soap': ['username', 'password', 'domain', 'sender', 'otpTemplate'],
  kavenegar: ['apiKey', 'sender', 'otpPattern'],
  ghasedak: ['apiKey', 'sender', 'otpPattern'],
  smsir: ['apiKey', 'sender', 'otpTemplateId'],
  melipayamak: ['username', 'password', 'sender', 'otpTemplate'],
};
const FIELD_LABELS: Record<string, string> = {
  sender: 'شماره خط / نام فرستنده', apiKey: 'کلید API', username: 'نام کاربری', password: 'رمز عبور',
  domain: 'دامنه حساب (Magfa)', otpPattern: 'نام/کد الگوی تایید (OTP)', otpTemplateId: 'شناسه الگوی تایید (SMS.ir)',
  otpTemplate: 'متن پیامک کد تایید (مطابق الگوی تاییدشده اپراتور؛ از {code} برای جای کد استفاده کنید)',
};
const SECRET = new Set(['apiKey', 'password']);

function SmsTab() {
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [testPhone, setTestPhone] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const load = () => client.get<any>('/tenant/sms-config', 'org').then((d) => { setC(d); setF({ driver: d.driver || 'console', sender: d.sender || '', username: d.username || '', domain: d.domain || '', otpPattern: d.otpPattern || '', otpTemplateId: d.otpTemplateId || '', otpTemplate: d.otpTemplate || '', notifyPhone: d.notifyPhone || '', apiKey: '', password: '' }); }).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try {
      const body: Record<string, string> = { driver: f.driver, sender: f.sender, notifyPhone: f.notifyPhone, username: f.username, domain: f.domain, otpPattern: f.otpPattern, otpTemplateId: f.otpTemplateId, otpTemplate: f.otpTemplate };
      if (f.apiKey) body.apiKey = f.apiKey;     // blank = keep stored secret
      if (f.password) body.password = f.password;
      await client.put('/tenant/sms-config', body, 'org'); setMsg({ t: 'ok', m: 'ذخیره شد' }); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const test = async () => {
    setMsg(null);
    try { await client.post('/tenant/sms-config/test', { phone: testPhone }, 'org'); setMsg({ t: 'ok', m: 'پیام آزمایشی ارسال شد' }); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const requestPlatform = async () => {
    setMsg(null);
    try { const d = await client.post<any>('/tenant/sms-config/request-platform', {}, 'org'); setC(d); setMsg({ t: 'ok', m: 'درخواست ارسال شد؛ در دست بررسی مدیر سکو.' }); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  if (!c) return null;
  const fields = DRIVER_FIELDS[f.driver] || [];
  return (
    <div className="card p-5 max-w-lg space-y-3">
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>درگاه پیامک این سازمان. برای ارسال کد تایید ورود و اطلاع‌رسانی ثبت‌نام‌ها استفاده می‌شود. اطلاعات اعتباری به‌صورت رمزنگاری‌شده ذخیره می‌شود.</p>
      {c.platformAvailable && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {c.usePlatform ? (
            <p className="text-sm" style={{ color: 'var(--success)' }}>✔ این سازمان مجاز به استفاده از درگاه پیامک سکو است. اگر درگاه اختصاصی ثبت نکنید، پیامک‌ها از طریق سکو ارسال می‌شود.</p>
          ) : c.usePlatformRequested ? (
            <p className="text-sm" style={{ color: 'var(--warning)' }}>⏳ درخواست استفاده از درگاه پیامک سکو ثبت شده و در دست بررسی مدیر سکو است.</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>درگاه پیامک اختصاصی ندارید؟ می‌توانید از درگاه پیامک سکو استفاده کنید.</span>
              <button onClick={requestPlatform} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>درخواست استفاده از درگاه سکو</button>
            </div>
          )}
        </div>
      )}
      <Field label="ارائه‌دهنده">
        <select className="input" value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}>
          {(c.drivers || []).map((d: string) => <option key={d} value={d}>{DRIVER_LABELS[d] || d}</option>)}
        </select>
      </Field>
      {fields.map((k) => (
        <Field key={k} label={FIELD_LABELS[k] + (SECRET.has(k) && (k === 'apiKey' ? c.hasApiKey : c.hasPassword) ? ' (تنظیم شده — برای تغییر وارد کنید)' : '')}>
          {k === 'otpTemplate' ? (
            <textarea className="input" rows={3} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={'کد تایید دامون: {code}\nاعتبار: ۵ دقیقه\nکارگزاری رسمی بیمه آتیه اندیشان دامون'} />
          ) : (
            <input className="input" type={SECRET.has(k) ? 'password' : 'text'} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={SECRET.has(k) ? '••••••••' : ''} style={{ direction: 'ltr', textAlign: 'left' }} />
          )}
        </Field>
      ))}
      <Field label="شماره موبایل مدیر برای اطلاع‌رسانی (اختیاری)"><input className="input" value={f.notifyPhone} onChange={(e) => setF({ ...f, notifyPhone: e.target.value })} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      <button onClick={save} className="btn btn-primary btn-sm">ذخیره درگاه</button>
      <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <h4 className="text-sm font-semibold mb-2">ارسال پیام آزمایشی</h4>
        <div className="flex gap-2">
          <input className="input" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} />
          <button onClick={test} disabled={!c.configured || !testPhone} className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>ارسال آزمایشی</button>
        </div>
      </div>
    </div>
  );
}

function BranchesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ name: '', code: '' });
  const [err, setErr] = useState('');
  const load = () => client.get<any[]>('/branches', 'org').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async () => { setErr(''); try { await client.post('/branches', f, 'org'); setF({ name: '', code: '' }); load(); } catch (e: any) { setErr(e.message); } };
  const del = async (id: string) => { try { await client.del(`/branches/${id}`, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن شعبه</h3>
        <ErrorBox message={err} />
        <Field label="نام شعبه"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="کد شعبه"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <button onClick={add} disabled={!f.name || !f.code} className="btn btn-primary btn-sm w-full">افزودن</button>
      </div>
      <div className="card divide-y h-fit" style={{ borderColor: 'var(--border)' }}>
        {rows.length === 0 ? <div className="p-5 text-sm text-center" style={{ color: 'var(--muted)' }}>شعبه‌ای نیست</div> :
          rows.map((r) => (
            <div key={r.id} className="flex justify-between items-center p-3">
              <span className="text-sm">{r.name} <span className="badge badge-neutral">{r.code}</span></span>
              <button onClick={() => del(r.id)} className="text-xs" style={{ color: 'var(--danger)' }}>حذف</button>
            </div>
          ))}
      </div>
    </div>
  );
}

function LevelsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ name: '', order: '', ceiling: '' });
  const [err, setErr] = useState('');
  const load = () => client.get<any[]>('/approval-levels', 'org').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async () => {
    setErr('');
    try { const body: any = { name: f.name, order: Number(f.order) }; if (f.ceiling) body.ceiling = f.ceiling.replace(/[^\d]/g, ''); await client.post('/approval-levels', body, 'org'); setF({ name: '', order: '', ceiling: '' }); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const del = async (id: string) => { try { await client.del(`/approval-levels/${id}`, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن سطح تایید</h3>
        <ErrorBox message={err} />
        <Field label="نام سطح"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="ترتیب"><input className="input" type="number" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="سقف اختیار (ریال، خالی = نامحدود)"><input className="input" value={f.ceiling} onChange={(e) => setF({ ...f, ceiling: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <button onClick={add} disabled={!f.name || !f.order} className="btn btn-primary btn-sm w-full">افزودن</button>
      </div>
      <div className="card divide-y h-fit" style={{ borderColor: 'var(--border)' }}>
        {rows.length === 0 ? <div className="p-5 text-sm text-center" style={{ color: 'var(--muted)' }}>سطحی تعریف نشده</div> :
          rows.map((r) => (
            <div key={r.id} className="flex justify-between items-center p-3 text-sm">
              <span><span className="badge badge-neutral">{r.order}</span> {r.name}</span>
              <span className="flex items-center gap-3"><span style={{ color: 'var(--muted)' }}>{r.ceiling ? `${Number(r.ceiling).toLocaleString('fa-IR')} ریال` : 'نامحدود'}</span><button onClick={() => del(r.id)} className="text-xs" style={{ color: 'var(--danger)' }}>حذف</button></span>
            </div>
          ))}
      </div>
    </div>
  );
}

function DocsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [label, setLabel] = useState('');
  const [types, setTypes] = useState<Set<string>>(new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']));
  const [busy, setBusy] = useState(false);
  const load = () => client.get<any[]>('/required-documents', 'org').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const seed = async () => { try { await client.post('/required-documents/seed-defaults', {}, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const toggle = async (r: any) => { try { await client.patch(`/required-documents/${r.id}`, { isActive: !r.isActive }, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const remove = async (r: any) => { if (!confirm(`حذف «${r.label}»؟`)) return; try { await client.del(`/required-documents/${r.id}`, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const toggleType = (t: string) => { const s = new Set(types); s.has(t) ? s.delete(t) : s.add(t); setTypes(s); };
  const add = async () => {
    setErr('');
    if (label.trim().length < 2) return setErr('شرح مدرک را وارد کنید');
    if (types.size === 0) return setErr('حداقل یک نوع پرونده را انتخاب کنید');
    setBusy(true);
    try {
      const maxOrder = rows.reduce((m, r) => Math.max(m, r.order || 0), 0);
      await client.post('/required-documents', { code: `other_${Date.now().toString(36)}`, label: label.trim(), appliesToTypes: [...types], order: Math.max(100, maxOrder + 1) }, 'org');
      setLabel(''); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <ErrorBox message={err} />
      {rows.length === 0 && <button onClick={seed} className="btn btn-primary btn-sm">بارگذاری فهرست پیش‌فرض</button>}
      <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
        {rows.length === 0 ? <div className="p-5 text-sm text-center" style={{ color: 'var(--muted)' }}>مدرکی تعریف نشده — فهرست پیش‌فرض را بارگذاری کنید</div> :
          rows.map((r) => (
            <div key={r.id} className="flex justify-between items-center p-3 gap-3">
              <span className="text-sm">{r.label} <span className="badge badge-neutral">{(r.appliesToTypes || []).map((t: string) => CLAIM_TYPE_LABELS[t] || t).join('، ')}</span></span>
              <span className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggle(r)} className={`badge ${r.isActive ? 'badge-success' : 'badge-neutral'}`} style={{ cursor: 'pointer' }}>{r.isActive ? 'فعال' : 'غیرفعال'}</button>
                <button onClick={() => remove(r)} className="text-xs" style={{ color: 'var(--danger)' }}>حذف</button>
              </span>
            </div>
          ))}
      </div>

      {/* سایر مدارک — add a custom required document (بیمه‌گزار uploads one file per item). */}
      <div className="card p-4 space-y-3">
        <h4 className="font-semibold text-sm">افزودن سایر مدارک</h4>
        <Field label="شرح مدرک"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً: رضایت‌نامه محضری وراث" /></Field>
        <div>
          <div className="label mb-1">برای کدام نوع پرونده الزامی است؟</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CLAIM_TYPE_LABELS).map(([v, l]) => (
              <button key={v} type="button" onClick={() => toggleType(v)} className="badge" style={types.has(v) ? { background: 'var(--brand)', color: '#fff', cursor: 'pointer' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
        </div>
        <button onClick={add} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'افزودن مدرک'}</button>
      </div>
    </div>
  );
}

function FieldsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const load = () => client.get<any[]>('/claim-fields', 'org').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const seed = async () => { try { await client.post('/claim-fields/seed-defaults', {}, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const toggle = async (r: any) => { try { await client.patch(`/claim-fields/${r.id}`, { isActive: !r.isActive }, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const G: Record<string, string> = { CLAIM_DATA: 'اطلاعات پرونده', BENEFICIARY: 'ذینفع', WORKFLOW_STAGE: 'گردش کار' };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <ErrorBox message={err} />
        {rows.length === 0 && <button onClick={seed} className="btn btn-primary btn-sm">بارگذاری فیلدهای پیش‌فرض</button>}
      </div>
      <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
        {rows.length === 0 ? <div className="p-5 text-sm text-center" style={{ color: 'var(--muted)' }}>فیلدی تعریف نشده</div> :
          rows.map((r) => (
            <div key={r.id} className="flex justify-between items-center p-3 gap-3">
              <span className="text-sm">{r.label} <span className="badge badge-neutral">{G[r.group] || r.group}</span> <span style={{ color: 'var(--muted)' }} className="text-xs">{(r.editableBy || []).join('/')}</span></span>
              <button onClick={() => toggle(r)} className={`badge ${r.isActive ? 'badge-success' : 'badge-neutral'}`} style={{ cursor: 'pointer' }}>{r.isActive ? 'فعال' : 'غیرفعال'}</button>
            </div>
          ))}
      </div>
    </div>
  );
}
