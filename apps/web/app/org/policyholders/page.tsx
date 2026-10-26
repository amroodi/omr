'use client';
import { useEffect, useState } from 'react';
import { OnProgress, UploadButton } from '../../components/upload';
import { toGregorian } from 'jalaali-js';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { Field, Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { ORG_NAV } from '../nav';
import { NetworkTab } from './network';

interface Acc { id: string; fullName: string | null; nationalCode: string | null; nationalCodeMasked: string | null; phone: string | null; phoneMasked: string | null; canViewPii: boolean; signupStatus: string; isActive: boolean; createdAt: string | null; lastLoginAt: string | null; company: { id: string; name: string } | null }
interface Contract { id: string; insurerTenantId: string; insurerName: string; line: 'LIFE' | 'ACCIDENT' | null; lineLabel: string | null; policyNumber: string | null; startDate: string | null; endDate: string | null; isActive: boolean; note: string | null; isCurrent: boolean }
interface Company {
  id: string; name: string; code: string | null; hasPassword: boolean; parentId: string | null; phone: string | null; email: string | null; address: string | null; website: string | null; contactName: string | null;
  isActive: boolean; hasLogo: boolean; accounts: number; currentInsurer: { id: string; name: string } | null; contracts: Contract[];
}
interface Msg { id: string; claimId: string; claimNumber: string; companyName: string | null; phone: string; message: string; createdAt: string; handled: boolean }

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'در انتظار تایید', cls: 'badge-warning' },
  ACTIVE: { label: 'فعال', cls: 'badge-success' },
  REJECTED: { label: 'ردشده', cls: 'badge-neutral' },
};
const TABS = [['map', 'نقشهٔ اتصال‌ها'], ['companies', 'شرکت‌های بیمه‌گزار'], ['accounts', 'نمایندگان (ورود به پنل بیمه‌گزار)'], ['messages', 'پیام‌های استعلام']] as const;
type Tab = (typeof TABS)[number][0];

function jalaliToIso(v: string): string | null {
  const p = v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((x) => !x)) return null;
  const g = toGregorian(p[0], p[1], p[2]);
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).toISOString();
}
const tabStyle = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });
const EMPTY_CO = { name: '', parentId: '', phone: '', email: '', address: '', website: '', contactName: '' };

export default function Policyholders() {
  const [tab, setTab] = useState<Tab>('map');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const loadCompanies = () => client.get<Company[]>('/policyholder-companies', 'org').then(setCompanies).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'messages' || t === 'accounts' || t === 'companies') setTab(t);
    loadCompanies();
  }, []);

  return (
    <Shell title="بیمه‌گزاران" subtitle="شرکت‌های بیمه‌گزار، اتصال هر شرکت به بیمه‌گر طبق قرارداد، و نمایندگان آن‌ها" nav={ORG_NAV} realm="org">
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className="btn btn-sm" style={tabStyle(tab === k)}>{l}</button>)}
      </div>
      {msg && <div className={`${msg.t === 'ok' ? 'alert-success' : 'alert-error'} mb-3`}>{msg.m}</div>}
      {tab === 'map' && <NetworkTab setMsg={setMsg} onChanged={loadCompanies} />}
      {tab === 'companies' && <CompaniesTab companies={companies} reload={loadCompanies} setMsg={setMsg} />}
      {tab === 'accounts' && <AccountsTab companies={companies} setMsg={setMsg} />}
      {tab === 'messages' && <MessagesTab setMsg={setMsg} />}
    </Shell>
  );
}

// ── شرکت‌های بیمه‌گزار ─────────────────────────────────────────────────────
function CompaniesTab({ companies, reload, setMsg }: { companies: Company[]; reload: () => void; setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void }) {
  const [f, setF] = useState(EMPTY_CO);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [insurers, setInsurers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then(setInsurers).catch(() => {}); }, []);

  const create = async () => {
    setMsg(null); setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || (k === 'parentId' ? null : undefined)]));
      const r = await client.post<{ id: string }>('/policyholder-companies', body, 'org');
      setMsg({ t: 'ok', m: 'شرکت بیمه‌گزار ثبت شد؛ اکنون قرارداد بیمه‌گر آن را تعیین کنید.' }); setF(EMPTY_CO); reload(); setOpenId(r.id);
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };

  const roots = companies.filter((c) => !c.parentId || !companies.some((p) => p.id === c.parentId));
  const childrenOf = (id: string) => companies.filter((c) => c.parentId === id);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن شرکت بیمه‌گزار</h3>
        <Field label="نام شرکت *"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="زیرمجموعهٔ (اختیاری)">
          <select className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">— شرکت مستقل —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="مسئول پیگیری (رفاه / منابع انسانی)"><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="تلفن"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="ایمیل"><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="نشانی"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <button onClick={create} disabled={busy || f.name.trim().length < 2} className="btn btn-primary btn-sm w-full">ثبت شرکت</button>
      </div>

      <div className="space-y-3">
        {companies.length === 0 && <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>هنوز شرکتی ثبت نشده است.</div>}
        {roots.map((c) => (
          <div key={c.id} className="space-y-2">
            <CompanyCard c={c} companies={companies} insurers={insurers} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} reload={reload} setMsg={setMsg} />
            {childrenOf(c.id).map((k) => (
              <div key={k.id} className="mr-6">
                <CompanyCard c={k} companies={companies} insurers={insurers} open={openId === k.id} onToggle={() => setOpenId(openId === k.id ? null : k.id)} reload={reload} setMsg={setMsg} sub />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompanyCard({ c, companies, insurers, open, onToggle, reload, setMsg, sub }: {
  c: Company; companies: Company[]; insurers: { id: string; name: string }[]; open: boolean; onToggle: () => void; reload: () => void;
  setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void; sub?: boolean;
}) {
  const [edit, setEdit] = useState({ name: c.name, parentId: c.parentId ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', website: c.website ?? '', contactName: c.contactName ?? '' });
  const [k, setK] = useState({ insurerTenantId: '', line: '', policyNumber: '', start: '', end: '', note: '' });
  const [logoVer, setLogoVer] = useState(0);
  const act = async (fn: () => Promise<any>, ok: string) => { setMsg(null); try { await fn(); setMsg({ t: 'ok', m: ok }); reload(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };

  const save = () => act(() => client.patch(`/policyholder-companies/${c.id}`, { ...edit, parentId: edit.parentId || null }, 'org'), 'ذخیره شد');
  const toggleActive = () => act(() => client.patch(`/policyholder-companies/${c.id}`, { isActive: !c.isActive }, 'org'), c.isActive ? 'شرکت غیرفعال شد' : 'شرکت فعال شد');
  const uploadLogo = async (file: File, onProgress: OnProgress) => {
    setMsg(null);
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/policyholder-companies/${c.id}/logo`, fd, 'org', onProgress);
    setLogoVer((v) => v + 1); setMsg({ t: 'ok', m: 'لوگو بارگذاری شد' }); reload();
  };
  const addContract = () => act(async () => {
    const startDate = k.start ? jalaliToIso(k.start) : null; const endDate = k.end ? jalaliToIso(k.end) : null;
    if ((k.start && !startDate) || (k.end && !endDate)) throw new Error('تاریخ نامعتبر است (نمونه: ۱۴۰۵/۰۱/۰۱)');
    await client.post(`/policyholder-companies/${c.id}/contracts`, { insurerTenantId: k.insurerTenantId, line: k.line || null, policyNumber: k.policyNumber || null, startDate, endDate, note: k.note || null }, 'org');
    setK({ insurerTenantId: '', line: '', policyNumber: '', start: '', end: '', note: '' });
  }, 'قرارداد ثبت شد؛ پرونده‌های جدید این شرکت بر اساس آن به بیمه‌گر ارسال می‌شوند.');
  const toggleContract = (ct: Contract) => act(() => client.patch(`/policyholder-companies/${c.id}/contracts/${ct.id}`, { isActive: !ct.isActive }, 'org'), ct.isActive ? 'قرارداد غیرفعال شد' : 'قرارداد فعال شد');

  return (
    <div className="card p-4" style={{ opacity: c.isActive ? 1 : 0.65 }}>
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-right flex-wrap">
        <span className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.hasLogo ? <img src={`${client.base}/policyholder-companies/${c.id}/logo?v=${logoVer}`} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
            : <span className="rounded-lg flex items-center justify-center font-bold" style={{ width: 36, height: 36, background: 'var(--surface-2)', color: 'var(--muted)' }}>{c.name.slice(0, 1)}</span>}
          <span className="min-w-0">
            <span className="font-bold block truncate">{sub ? '↳ ' : ''}{c.name}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.code ? `کد بیمه‌گزار ${c.code} · ` : ''}{c.accounts.toLocaleString('fa-IR')} نماینده{c.contactName ? ` · ${c.contactName}` : ''}</span>
          </span>
        </span>
        <span className="flex items-center gap-2 flex-wrap justify-end">
          {!c.isActive && <span className="badge badge-neutral">غیرفعال</span>}
          {c.currentInsurer ? <span className="badge badge-success">بیمه‌گر فعلی: {c.currentInsurer.name}</span> : <span className="badge badge-warning">بدون قرارداد فعال</span>}
          <span style={{ color: 'var(--muted)' }}>{open ? '▴' : '▾'}</span>
        </span>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t space-y-5" style={{ borderColor: 'var(--border)' }}>
          {/* Insurer contracts */}
          <div>
            <h4 className="font-semibold text-sm mb-2">قراردادهای بیمه (اتصال به بیمه‌گر)</h4>
            <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>پرونده‌ای که بیمه‌گزار ثبت می‌کند به بیمه‌گرِ قراردادی می‌رود که در تاریخ فوت معتبر بوده است. هر زمان می‌توانید قرارداد جدید ثبت یا قرارداد قبلی را غیرفعال کنید؛ پرونده‌های قبلی تغییر نمی‌کنند.</p>
            {c.contracts.length > 0 && (
              <div className="overflow-x-auto mb-3">
                <table className="table">
                  <thead><tr>{['بیمه‌گر', 'رشته', 'شماره بیمه‌نامه', 'از', 'تا', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {c.contracts.map((ct) => (
                      <tr key={ct.id}>
                        <td className="font-semibold">{ct.insurerName}{ct.isCurrent && <span className="badge badge-success mr-1">فعلی</span>}</td>
                        <td>{ct.lineLabel || '—'}</td>
                        <td>{ct.policyNumber || '—'}</td>
                        <td>{ct.startDate || 'نامحدود'}</td>
                        <td>{ct.endDate || 'نامحدود'}</td>
                        <td>{ct.isActive ? 'فعال' : 'غیرفعال'}</td>
                        <td><button onClick={() => toggleContract(ct)} className="text-xs" style={{ color: ct.isActive ? 'var(--danger)' : 'var(--success)' }}>{ct.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <Field label="بیمه‌گر *">
                <select className="input" value={k.insurerTenantId} onChange={(e) => setK({ ...k, insurerTenantId: e.target.value })}>
                  <option value="">— انتخاب —</option>
                  {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="رشته">
                <select className="input" value={k.line} onChange={(e) => setK({ ...k, line: e.target.value })}>
                  <option value="">—</option><option value="LIFE">عمر</option><option value="ACCIDENT">حوادث</option>
                </select>
              </Field>
              <Field label="شماره بیمه‌نامه"><input className="input" value={k.policyNumber} onChange={(e) => setK({ ...k, policyNumber: e.target.value })} /></Field>
              <Field label="از تاریخ"><JalaliDatePicker value={k.start} onChange={(v) => setK({ ...k, start: v })} placeholder="۱۴۰۵/۰۱/۰۱" /></Field>
              <Field label="تا تاریخ (خالی = نامحدود)"><JalaliDatePicker value={k.end} onChange={(v) => setK({ ...k, end: v })} placeholder="۱۴۰۵/۱۲/۲۹" /></Field>
            </div>
            <button onClick={addContract} disabled={!k.insurerTenantId} className="btn btn-primary btn-sm mt-2">ثبت قرارداد</button>
            {insurers.length === 0 && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>هیچ بیمه‌گر همکاری برای این کارگزاری تعریف نشده است (مدیر سامانه).</p>}
          </div>

          {/* Company details */}
          <div>
            <h4 className="font-semibold text-sm mb-2">مشخصات و اطلاعات تماس (در استعلام به ذینفعان نمایش داده می‌شود)</h4>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="نام شرکت"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="زیرمجموعهٔ">
                <select className="input" value={edit.parentId} onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}>
                  <option value="">— شرکت مستقل —</option>
                  {companies.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="مسئول پیگیری"><input className="input" value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
              <Field label="تلفن"><input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              <Field label="ایمیل"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              <Field label="وب‌سایت"><input className="input" value={edit.website} onChange={(e) => setEdit({ ...edit, website: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              <div className="sm:col-span-2"><Field label="نشانی"><input className="input" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field></div>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button onClick={save} className="btn btn-primary btn-sm">ذخیرهٔ مشخصات</button>
              <UploadButton onUpload={uploadLogo} accept=".png,.jpg,.jpeg,.webp" maxMB={2} title={c.hasLogo ? 'تغییر لوگو' : 'بارگذاری لوگو'} subtitle={c.name}>{c.hasLogo ? 'تغییر لوگو' : 'بارگذاری لوگو'}</UploadButton>
              <button onClick={toggleActive} className="btn btn-ghost btn-sm" style={{ color: c.isActive ? 'var(--danger)' : 'var(--success)' }}>{c.isActive ? 'غیرفعال‌سازی شرکت' : 'فعال‌سازی شرکت'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── نمایندگان (حساب‌های ورود بیمه‌گزار) ─────────────────────────────────────
function AccountsTab({ companies, setMsg }: { companies: Company[]; setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void }) {
  const [rows, setRows] = useState<Acc[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING'>('ALL');
  const [f, setF] = useState({ nationalCode: '', phone: '', fullName: '', companyId: '' });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  const load = () => {
    const q = filter === 'PENDING' ? '?status=PENDING' : '';
    client.get<Acc[]>(`/customer/accounts${q}`, 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
    client.get<{ count: number }>('/customer/accounts/pending-count', 'org').then((d) => setPending(d.count)).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const create = async () => {
    setMsg(null); setBusy(true);
    try {
      await client.post('/customer/accounts', { ...f, companyId: f.companyId || undefined, fullName: f.fullName || undefined }, 'org');
      setMsg({ t: 'ok', m: 'نمایندهٔ بیمه‌گزار ثبت شد' }); setF({ nationalCode: '', phone: '', fullName: '', companyId: '' }); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const setStatus = async (r: Acc, action: 'approve' | 'reject') => {
    const name = r.fullName || r.nationalCode || r.nationalCodeMasked || 'این حساب';
    const verb = action === 'approve' ? 'تایید/فعال‌سازی' : (r.signupStatus === 'ACTIVE' ? 'تعلیق (غیرفعال‌سازی)' : 'رد');
    if (!window.confirm(`${verb} «${name}»؟`)) return;
    try { await client.post(`/customer/accounts/${r.id}/${action}`, {}, 'org'); setMsg({ t: 'ok', m: 'وضعیت تغییر کرد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const assign = async (r: Acc, companyId: string) => {
    try { await client.put(`/policyholder-companies/accounts/${r.id}`, { companyId: companyId || null }, 'org'); setMsg({ t: 'ok', m: 'شرکت نماینده تغییر کرد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن نمایندهٔ بیمه‌گزار (تایید فوری)</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>نماینده با کد ملی و کد پیامکی وارد پنل بیمه‌گزار می‌شود و پرونده‌ها را برای شرکت خود ثبت می‌کند.</p>
        <Field label="شرکت بیمه‌گزار *">
          <select className="input" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">— انتخاب شرکت —</option>
            {companies.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="کد ملی"><input className="input" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="موبایل"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="نام و نام خانوادگی (اختیاری)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <button onClick={create} disabled={busy || !f.nationalCode || !f.phone || !f.companyId} className="btn btn-primary btn-sm w-full">ثبت نماینده</button>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setFilter('PENDING')} className="btn btn-sm" style={tabStyle(filter === 'PENDING')}>در انتظار تایید{pending > 0 ? ` (${pending})` : ''}</button>
          <button onClick={() => setFilter('ALL')} className="btn btn-sm" style={tabStyle(filter === 'ALL')}>همه</button>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{['نام', 'شرکت بیمه‌گزار', 'کد ملی', 'موبایل', 'وضعیت', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>موردی نیست</td></tr> :
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.fullName || '—'}</td>
                    <td>
                      <select className="input" style={{ minWidth: 170, padding: '4px 8px' }} value={r.company?.id ?? ''} onChange={(e) => assign(r, e.target.value)}>
                        <option value="">— بدون شرکت —</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.nationalCode || r.nationalCodeMasked}</td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.phone || r.phoneMasked || '—'}</td>
                    <td><span className={`badge ${STATUS[r.signupStatus]?.cls || 'badge-neutral'}`}>{STATUS[r.signupStatus]?.label || r.signupStatus}</span></td>
                    <td>
                      <span className="flex gap-2">
                        {r.signupStatus !== 'ACTIVE' && <button onClick={() => setStatus(r, 'approve')} className="text-xs" style={{ color: 'var(--success)' }}>{r.signupStatus === 'PENDING' ? 'تایید' : 'فعال‌سازی'}</button>}
                        {r.signupStatus === 'PENDING' && <button onClick={() => setStatus(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }}>رد</button>}
                        {r.signupStatus === 'ACTIVE' && <button onClick={() => setStatus(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }}>تعلیق</button>}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── پیام‌های استعلام («پاسخگوی آنلاین») ────────────────────────────────────
function MessagesTab({ setMsg }: { setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void }) {
  const [rows, setRows] = useState<Msg[] | null>(null);
  const load = () => client.get<Msg[]>('/policyholder-companies/messages', 'org').then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const done = async (m: Msg) => { try { await client.post(`/policyholder-companies/messages/${m.id}/handled`, {}, 'org'); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); } };
  if (!rows) return <div className="card p-8 text-center"><Spinner /></div>;
  if (rows.length === 0) return <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>پیامی از استعلام‌کنندگان دریافت نشده است.</div>;
  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <div key={m.id} className="card p-4" style={{ opacity: m.handled ? 0.6 : 1 }}>
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="font-bold">پرونده <a href={`/org/claims/${m.claimId}`} style={{ color: 'var(--brand)' }}>{m.claimNumber}</a>{m.companyName ? ` — ${m.companyName}` : ''}</span>
            <span style={{ color: 'var(--muted)' }}>{m.createdAt}</span>
          </div>
          <p className="text-sm mt-2 whitespace-pre-wrap">{m.message}</p>
          <div className="flex items-center justify-between gap-2 mt-2 text-sm">
            <span>تماس با استعلام‌کننده: <a href={`tel:${m.phone}`} dir="ltr" style={{ color: 'var(--brand)', fontWeight: 700 }}>{m.phone}</a></span>
            {m.handled ? <span className="badge badge-success">پاسخ داده شد</span> : <button onClick={() => done(m)} className="btn btn-ghost btn-sm">ثبت «پاسخ داده شد»</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
