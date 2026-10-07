'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearToken, client, getToken } from '../../lib/client';
import { ErrorBox, Field, StatCard } from '../components/ui';
import { Icon } from '../components/Shell';
import { ChangePasswordModal } from '../components/ChangePasswordModal';

interface Tenant {
  id: string; slug: string; name: string; isActive: boolean;
  _count: { orgUsers: number; cases: number; customers: number };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({ name: '', slug: '', kind: 'BROKER', adminUsername: 'admin', adminDisplayName: '' });
  const [result, setResult] = useState<{ username: string; oneTimePassword: string } | null>(null);
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [resetResult, setResetResult] = useState<{ name: string; username: string; oneTimePassword: string } | null>(null);

  const load = () => client.get<Tenant[]>('/tenants', 'super').then(setTenants).catch((e) => setError(e.message));
  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAdmin = async (t: Tenant) => {
    setError(''); setResetResult(null);
    if (!confirm(`بازنشانی رمز عبور مدیر سازمان «${t.name}»؟ رمز فعلی باطل می‌شود.`)) return;
    try {
      const r = await client.post<{ username: string; oneTimePassword: string }>(`/tenants/${t.id}/reset-admin`, {}, 'super');
      setResetResult({ name: t.name, ...r });
    } catch (e: any) { setError(e.message); }
  };

  const totals = useMemo(() => ({
    orgs: tenants.length,
    active: tenants.filter((t) => t.isActive).length,
    cases: tenants.reduce((s, t) => s + t._count.cases, 0),
    customers: tenants.reduce((s, t) => s + t._count.customers, 0),
  }), [tenants]);

  const provision = async () => {
    setError(''); setResult(null);
    try {
      const payload: Record<string, string> = { name: form.name.trim(), slug: form.slug.trim(), kind: form.kind, adminUsername: form.adminUsername.trim() };
      if (form.adminDisplayName.trim()) payload.adminDisplayName = form.adminDisplayName.trim();
      const r = await client.post<{ admin: { username: string; oneTimePassword: string } }>('/tenants', payload, 'super');
      setResult(r.admin);
      setForm({ name: '', slug: '', kind: 'BROKER', adminUsername: 'admin', adminDisplayName: '' });
      load();
    } catch (e: any) { setError(e.message); }
  };
  const toggle = async (t: Tenant) => {
    try { await client.patch(`/tenants/${t.id}/active`, { isActive: !t.isActive }, 'super'); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h1 className="text-2xl font-extrabold">مدیریت سازمان‌ها</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>تامین و مدیریت سازمان‌های سکو</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPw(true)} className="btn btn-ghost btn-sm">
            <Icon path="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM8 11V7a4 4 0 118 0v4" /> تغییر رمز عبور
          </button>
          <button onClick={() => { clearToken('super'); router.push('/admin/login'); }} className="btn btn-ghost btn-sm">
            <Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج
          </button>
        </div>
      </div>

      {showPw && <ChangePasswordModal onClose={() => setShowPw(false)} />}
      {resetResult && (
        <div className="alert-success mb-4">
          رمز جدید مدیر «{resetResult.name}» ساخته شد — کاربری: <b>{resetResult.username}</b> · رمز یک‌بارمصرف: <b style={{ direction: 'ltr', display: 'inline-block' }}>{resetResult.oneTimePassword}</b>
          <button onClick={() => setResetResult(null)} className="mr-3 text-xs underline">بستن</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="سازمان‌ها" value={totals.orgs} tone="brand" icon={<Icon path="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01" />} />
        <StatCard label="فعال" value={totals.active} tone="success" icon={<Icon path="M20 6L9 17l-5-5" />} />
        <StatCard label="کل پرونده‌ها" value={totals.cases} tone="warning" icon={<Icon path="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />} />
        <StatCard label="کل بیمه‌گزاران" value={totals.customers} tone="muted" icon={<Icon path="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" />} />
      </div>

      <ErrorBox message={error} />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card p-5 space-y-3 lg:col-span-1 h-fit">
          <h3 className="font-semibold">ایجاد سازمان جدید</h3>
          <Field label="نام سازمان"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></Field>
          <Field label="نوع سازمان">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="input">
              <option value="BROKER">کارگزاری / نمایندگی (معرف)</option>
              <option value="INSURER">شرکت بیمه (بیمه‌گر) — دارای کاتالوگ مدارک و فیلدها</option>
            </select>
          </Field>
          <Field label="شناسه (انگلیسی)"><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="input" style={{ direction: 'ltr', textAlign: 'left' }} placeholder="alborz" /></Field>
          <Field label="نام کاربری مدیر"><input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} className="input" /></Field>
          <Field label="نام نمایشی مدیر (اختیاری)"><input value={form.adminDisplayName} onChange={(e) => setForm({ ...form, adminDisplayName: e.target.value })} className="input" /></Field>
          <button onClick={provision} disabled={!form.name || !form.slug} className="btn btn-primary w-full">ایجاد سازمان و مدیر</button>
          {result && (
            <div className="alert-success">
              مدیر ساخته شد.<br />کاربری: <b>{result.username}</b><br />رمز یک‌بار مصرف: <b style={{ direction: 'ltr', display: 'inline-block' }}>{result.oneTimePassword}</b>
              <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>این رمز فقط یک‌بار نمایش داده می‌شود.</div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-5">
        <div className="card overflow-x-auto h-fit">
          <table className="table">
            <thead><tr>{['نام', 'شناسه', 'کاربران', 'پرونده‌ها', 'بیمه‌گزاران', 'وضعیت', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="font-semibold">{t.name}</td>
                  <td style={{ direction: 'ltr', textAlign: 'right' }}>{t.slug}</td>
                  <td>{t._count.orgUsers}</td>
                  <td>{t._count.cases}</td>
                  <td>{t._count.customers}</td>
                  <td>
                    <button onClick={() => toggle(t)} className={`badge ${t.isActive ? 'badge-success' : 'badge-neutral'}`} style={{ cursor: 'pointer' }}>
                      {t.isActive ? 'فعال' : 'غیرفعال'}
                    </button>
                  </td>
                  <td>
                    <button onClick={() => resetAdmin(t)} className="text-xs" style={{ color: 'var(--brand)' }}>بازنشانی رمز مدیر</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PlatformSms />
        </div>
      </div>
    </div>
  );
}

function PlatformSms() {
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [reqs, setReqs] = useState<any[]>([]);
  const [testPhone, setTestPhone] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const DLABEL: Record<string, string> = { console: 'کنسول (آزمایشی)', magfa: 'مگفا', kavenegar: 'کاوه‌نگار', ghasedak: 'قاصدک', smsir: 'SMS.ir', melipayamak: 'ملی‌پیامک' };
  const DFIELDS: Record<string, string[]> = { console: ['otpTemplate'], magfa: ['username', 'password', 'domain', 'sender', 'otpTemplate'], kavenegar: ['apiKey', 'sender', 'otpPattern'], ghasedak: ['apiKey', 'sender', 'otpPattern'], smsir: ['apiKey', 'sender', 'otpTemplateId'], melipayamak: ['username', 'password', 'sender', 'otpTemplate'] };
  const FLABEL: Record<string, string> = { sender: 'خط/فرستنده', apiKey: 'کلید API', username: 'نام کاربری', password: 'رمز', domain: 'دامنه', otpPattern: 'الگوی OTP', otpTemplateId: 'شناسه الگو', otpTemplate: 'متن کد تایید (از {code} استفاده کنید)' };
  const SECRET = new Set(['apiKey', 'password']);
  const load = () => {
    client.get<any>('/platform/sms-config', 'super').then((d) => { setC(d); setF({ driver: d.driver || 'magfa', sender: d.sender || '', username: d.username || '', domain: d.domain || '', otpPattern: d.otpPattern || '', otpTemplateId: d.otpTemplateId || '', otpTemplate: d.otpTemplate || '', apiKey: '', password: '' }); }).catch((e) => setMsg({ t: 'err', m: e.message }));
    client.get<any[]>('/platform/sms-requests', 'super').then(setReqs).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    setMsg(null);
    try { const b: Record<string, string> = { driver: f.driver, sender: f.sender, username: f.username, domain: f.domain, otpPattern: f.otpPattern, otpTemplateId: f.otpTemplateId, otpTemplate: f.otpTemplate }; if (f.apiKey) b.apiKey = f.apiKey; if (f.password) b.password = f.password; await client.put('/platform/sms-config', b, 'super'); setMsg({ t: 'ok', m: 'ذخیره شد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const test = async () => { setMsg(null); try { await client.post('/platform/sms-config/test', { phone: testPhone }, 'super'); setMsg({ t: 'ok', m: 'پیام آزمایشی ارسال شد' }); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };
  const setPlatform = async (id: string, enabled: boolean) => { try { await client.post(`/platform/tenants/${id}/sms-platform`, { enabled }, 'super'); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };
  if (!c) return null;
  const fields = DFIELDS[f.driver] || [];
  return (
    <div className="card p-5 space-y-3">
      <h3 className="font-semibold">درگاه پیامک سکو (میزبان)</h3>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>این درگاه کدهای تایید ثبت‌نام (پیش از عضویت در سازمان) را ارسال می‌کند و در اختیار سازمان‌هایی که درگاه اختصاصی ندارند و تاییدشان کرده‌اید قرار می‌گیرد.</p>
      {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="ارائه‌دهنده"><select className="input" value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })}>{(c.drivers || []).map((d: string) => <option key={d} value={d}>{DLABEL[d] || d}</option>)}</select></Field>
        {fields.map((k) => (
          <Field key={k} label={FLABEL[k] + (SECRET.has(k) && (k === 'apiKey' ? c.hasApiKey : c.hasPassword) ? ' (تنظیم‌شده)' : '')}>
            {k === 'otpTemplate' ? (
              <textarea className="input" rows={3} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={'کد تایید دامون: {code}\nاعتبار: ۵ دقیقه\nکارگزاری رسمی بیمه آتیه اندیشان دامون'} />
            ) : (
              <input className="input" type={SECRET.has(k) ? 'password' : 'text'} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={SECRET.has(k) ? '••••••' : ''} style={{ direction: 'ltr', textAlign: 'left' }} />
            )}
          </Field>
        ))}
      </div>
      <div className="flex gap-2 items-end">
        <button onClick={save} className="btn btn-primary btn-sm">ذخیره درگاه سکو</button>
        <input className="input" style={{ maxWidth: 160, direction: 'ltr', textAlign: 'right' }} value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="۰۹۱۲… آزمایشی" />
        <button onClick={test} disabled={!c.configured || !testPhone} className="btn btn-ghost btn-sm">ارسال آزمایشی</button>
      </div>
      <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
        <h4 className="text-sm font-semibold mb-2">سازمان‌های متقاضی/مجاز استفاده از پیامک سکو</h4>
        {reqs.length === 0 ? <p className="text-xs" style={{ color: 'var(--muted)' }}>موردی نیست</p> : (
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {reqs.map((r) => (
              <div key={r.id} className="flex justify-between items-center py-2 text-sm">
                <span>{r.name} {r.smsUsePlatform ? <span className="badge badge-success">مجاز</span> : <span className="badge badge-warning">در انتظار</span>}</span>
                {r.smsUsePlatform
                  ? <button onClick={() => setPlatform(r.id, false)} className="text-xs" style={{ color: 'var(--danger)' }}>لغو دسترسی</button>
                  : <button onClick={() => setPlatform(r.id, true)} className="text-xs" style={{ color: 'var(--success)' }}>تایید دسترسی</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
