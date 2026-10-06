'use client';
import { useEffect, useRef, useState } from 'react';
import { client } from '../../../lib/client';
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
    </Shell>
  );
}

function BrandingTab() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const load = () => client.get<any>('/tenant/settings', 'org').then(setS).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try { await client.patch('/tenant/settings', { name: s.name, primaryColor: s.primaryColor, contactHeader: s.contactHeader, noticeDays: Number(s.noticeDays) }, 'org'); setMsg({ t: 'ok', m: 'ذخیره شد' }); load(); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const uploadLogo = async (file: File) => {
    try { const fd = new FormData(); fd.append('file', file); await client.postForm('/tenant/assets/logo', fd, 'org'); setMsg({ t: 'ok', m: 'لوگو بارگذاری شد' }); load(); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  if (!s) return null;
  return (
    <div className="card p-5 max-w-lg space-y-3">
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <Field label="نام سازمان"><input className="input" value={s.name || ''} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
      <Field label="رنگ اصلی"><input className="input" type="text" value={s.primaryColor || ''} onChange={(e) => setS({ ...s, primaryColor: e.target.value })} placeholder="#FF9500" style={{ direction: 'ltr' }} /></Field>
      <Field label="سربرگ تماس (در خروجی‌ها)"><input className="input" value={s.contactHeader || ''} onChange={(e) => setS({ ...s, contactHeader: e.target.value })} /></Field>
      <Field label="مهلت اعلام خسارت (روز)"><input className="input" type="number" value={s.noticeDays ?? 30} onChange={(e) => setS({ ...s, noticeDays: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
      <div className="flex gap-2 items-center">
        <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
        <button onClick={() => logoRef.current?.click()} className="btn btn-ghost btn-sm">{s.hasLogo ? 'تغییر لوگو' : 'بارگذاری لوگو'}</button>
        {s.hasLogo && <span className="badge badge-success">لوگو تنظیم شده</span>}
      </div>
      <button onClick={save} className="btn btn-primary btn-sm">ذخیره</button>
    </div>
  );
}

const DRIVER_LABELS: Record<string, string> = {
  console: 'کنسول (آزمایشی — بدون ارسال واقعی)', magfa: 'مگفا (Magfa)', kavenegar: 'کاوه‌نگار',
  ghasedak: 'قاصدک', smsir: 'SMS.ir', melipayamak: 'ملی‌پیامک',
};
// Which fields each provider needs, to show only the relevant inputs.
const DRIVER_FIELDS: Record<string, string[]> = {
  console: ['sender'],
  magfa: ['username', 'password', 'domain', 'sender'],
  kavenegar: ['apiKey', 'sender', 'otpPattern'],
  ghasedak: ['apiKey', 'sender', 'otpPattern'],
  smsir: ['apiKey', 'sender', 'otpTemplateId'],
  melipayamak: ['username', 'password', 'sender', 'otpPattern'],
};
const FIELD_LABELS: Record<string, string> = {
  sender: 'شماره خط / نام فرستنده', apiKey: 'کلید API', username: 'نام کاربری', password: 'رمز عبور',
  domain: 'دامنه حساب (Magfa)', otpPattern: 'نام/کد الگوی تایید (OTP)', otpTemplateId: 'شناسه الگوی تایید (SMS.ir)',
};
const SECRET = new Set(['apiKey', 'password']);

function SmsTab() {
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [testPhone, setTestPhone] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const load = () => client.get<any>('/tenant/sms-config', 'org').then((d) => { setC(d); setF({ driver: d.driver || 'console', sender: d.sender || '', username: d.username || '', domain: d.domain || '', otpPattern: d.otpPattern || '', otpTemplateId: d.otpTemplateId || '', notifyPhone: d.notifyPhone || '', apiKey: '', password: '' }); }).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try {
      const body: Record<string, string> = { driver: f.driver, sender: f.sender, notifyPhone: f.notifyPhone, username: f.username, domain: f.domain, otpPattern: f.otpPattern, otpTemplateId: f.otpTemplateId };
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
  if (!c) return null;
  const fields = DRIVER_FIELDS[f.driver] || [];
  return (
    <div className="card p-5 max-w-lg space-y-3">
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>درگاه پیامک این سازمان. برای ارسال کد تایید ورود و اطلاع‌رسانی ثبت‌نام‌ها استفاده می‌شود. اطلاعات اعتباری به‌صورت رمزنگاری‌شده ذخیره می‌شود.</p>
      <Field label="ارائه‌دهنده">
        <select className="input" value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}>
          {(c.drivers || []).map((d: string) => <option key={d} value={d}>{DRIVER_LABELS[d] || d}</option>)}
        </select>
      </Field>
      {fields.map((k) => (
        <Field key={k} label={FIELD_LABELS[k] + (SECRET.has(k) && (k === 'apiKey' ? c.hasApiKey : c.hasPassword) ? ' (تنظیم شده — برای تغییر وارد کنید)' : '')}>
          <input className="input" type={SECRET.has(k) ? 'password' : 'text'} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={SECRET.has(k) ? '••••••••' : ''} style={{ direction: 'ltr', textAlign: 'left' }} />
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
    <div className="grid lg:grid-cols-[300px_1fr] gap-5">
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
    <div className="grid lg:grid-cols-[300px_1fr] gap-5">
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
  const load = () => client.get<any[]>('/required-documents', 'org').then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const seed = async () => { try { await client.post('/required-documents/seed-defaults', {}, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  const toggle = async (r: any) => { try { await client.patch(`/required-documents/${r.id}`, { isActive: !r.isActive }, 'org'); load(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <ErrorBox message={err} />
        {rows.length === 0 && <button onClick={seed} className="btn btn-primary btn-sm">بارگذاری فهرست پیش‌فرض</button>}
      </div>
      <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
        {rows.length === 0 ? <div className="p-5 text-sm text-center" style={{ color: 'var(--muted)' }}>مدرکی تعریف نشده — فهرست پیش‌فرض را بارگذاری کنید</div> :
          rows.map((r) => (
            <div key={r.id} className="flex justify-between items-center p-3 gap-3">
              <span className="text-sm">{r.label} <span className="badge badge-neutral">{(r.appliesToTypes || []).map((t: string) => CLAIM_TYPE_LABELS[t] || t).join('، ')}</span></span>
              <button onClick={() => toggle(r)} className={`badge ${r.isActive ? 'badge-success' : 'badge-neutral'}`} style={{ cursor: 'pointer' }}>{r.isActive ? 'فعال' : 'غیرفعال'}</button>
            </div>
          ))}
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
