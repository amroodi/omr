'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { Field } from '../../components/ui';
import { ORG_NAV } from '../nav';
import { NetworkTab } from './network';

interface Acc { id: string; fullName: string | null; nationalCode: string | null; nationalCodeMasked: string | null; phone: string | null; phoneMasked: string | null; canViewPii: boolean; signupStatus: string; isActive: boolean; createdAt: string | null; lastLoginAt: string | null; company: { id: string; name: string } | null; hasPassword?: boolean; mustChangePassword?: boolean; shahkarVerified?: boolean }
// Only what the نمایندگان tab needs (the company picker).
interface Company { id: string; name: string; isActive: boolean }

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'در دست بررسی', cls: 'badge-warning' },
  ACTIVE: { label: 'فعال', cls: 'badge-success' },
  REJECTED: { label: 'ردشده', cls: 'badge-neutral' },
};
// Companies and their contracts are managed in Super Admin; inquiry questions live in «پاسخگوی آنلاین».
const TABS = [['map', 'نقشهٔ اتصال‌ها'], ['accounts', 'نمایندگان (ورود به پنل بیمه‌گزار)']] as const;
type Tab = (typeof TABS)[number][0];

const tabStyle = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });

export default function Policyholders() {
  const [tab, setTab] = useState<Tab | null>(null);
  // The connection map is the کارگزاری's view; an insurer (بیمه‌گر) panel doesn't get it at all.
  const [isBroker, setIsBroker] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const loadCompanies = () => client.get<Company[]>('/policyholder-companies', 'org').then(setCompanies).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    client.get<{ kind?: string }>('/tenant/branding', 'org').then((b) => {
      const broker = b.kind !== 'INSURER';
      setIsBroker(broker);
      setTab(t === 'accounts' || !broker ? 'accounts' : 'map');
    }).catch(() => { setIsBroker(true); setTab(t === 'accounts' ? 'accounts' : 'map'); }); // the API itself refuses the map to an insurer
    loadCompanies();
  }, []);
  const tabs = TABS.filter(([k]) => k !== 'map' || isBroker);

  return (
    <Shell title="بیمه‌گزاران" subtitle="اتصال هر شرکت بیمه‌گزار به بیمه‌گر طبق قرارداد، و نمایندگان آن‌ها" nav={ORG_NAV} realm="org">
      <div className="flex flex-wrap gap-2 mb-4">
        {isBroker !== null && tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className="btn btn-sm" style={tabStyle(tab === k)}>{l}</button>)}
      </div>
      {msg && <div className={`${msg.t === 'ok' ? 'alert-success' : 'alert-error'} mb-3`}>{msg.m}</div>}
      {tab === 'map' && isBroker && <NetworkTab setMsg={setMsg} onChanged={loadCompanies} />}
      {tab === 'accounts' && <AccountsTab companies={companies} setMsg={setMsg} />}
    </Shell>
  );
}

// ── نمایندگان (حساب‌های ورود بیمه‌گزار) ─────────────────────────────────────
function AccountsTab({ companies, setMsg }: { companies: Company[]; setMsg: (m: { t: 'ok' | 'err'; m: string } | null) => void }) {
  const [rows, setRows] = useState<Acc[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING'>('ALL');
  const [f, setF] = useState({ nationalCode: '', phone: '', fullName: '', companyId: '', password: '' });
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
      await client.post('/customer/accounts', { ...f, companyId: f.companyId || undefined, fullName: f.fullName || undefined, password: f.password || undefined }, 'org');
      setMsg({ t: 'ok', m: f.password ? 'نمایندهٔ بیمه‌گزار ثبت شد' : 'نمایندهٔ بیمه‌گزار ثبت شد؛ رمز عبور اولیه همان کد ملی است.' }); setF({ nationalCode: '', phone: '', fullName: '', companyId: '', password: '' }); load();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const setStatus = async (r: Acc, action: 'approve' | 'reject') => {
    const name = r.fullName || r.nationalCode || r.nationalCodeMasked || 'این حساب';
    const verb = action === 'approve' ? 'تایید/فعال‌سازی' : (r.signupStatus === 'ACTIVE' ? 'تعلیق (غیرفعال‌سازی)' : 'رد');
    if (!window.confirm(`${verb} «${name}»؟`)) return;
    try { await client.post(`/customer/accounts/${r.id}/${action}`, {}, 'org'); setMsg({ t: 'ok', m: 'وضعیت تغییر کرد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  // Set a نماینده's password; empty = back to their کد ملی.
  const setPassword = async (r: Acc) => {
    const pw = window.prompt(`رمز عبور تازهٔ «${r.fullName || r.nationalCodeMasked || 'نماینده'}» (دست‌کم ۸ نویسه).\nخالی بگذارید تا رمز به کد ملی بازنشانی شود:`, '');
    if (pw === null) return;
    try { const d = await client.post<{ message: string }>(`/customer/accounts/${r.id}/password`, { password: pw.trim() || undefined }, 'org'); setMsg({ t: 'ok', m: d.message }); load(); }
    catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  // Remove: hidden and signed out at once; the cases they filed stay with their company.
  const remove = async (r: Acc) => {
    const name = r.fullName || r.nationalCode || r.nationalCodeMasked || 'این نماینده';
    if (!window.confirm(`«${name}» از نمایندگان حذف شود؟\nدیگر نمی‌تواند وارد پنل بیمه‌گزار شود؛ پرونده‌هایی که ثبت کرده برای شرکت باقی می‌مانند.`)) return;
    try { await client.del(`/customer/accounts/${r.id}`, 'org'); setMsg({ t: 'ok', m: 'نماینده حذف شد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };
  const assign = async (r: Acc, companyId: string) => {
    try { await client.put(`/policyholder-companies/accounts/${r.id}`, { companyId: companyId || null }, 'org'); setMsg({ t: 'ok', m: 'شرکت نماینده تغییر کرد' }); load(); } catch (e: any) { setMsg({ t: 'err', m: e.message }); }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن نمایندهٔ بیمه‌گزار (تایید فوری)</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>نماینده با کد ملی (نام کاربری) و رمز عبور وارد پنل بیمه‌گزار می‌شود و برای شرکت خود پرونده ثبت و مدارک بارگذاری می‌کند.</p>
        <Field label="شرکت بیمه‌گزار *">
          <select className="input" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">— انتخاب شرکت —</option>
            {companies.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="کد ملی"><input className="input" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="موبایل"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="نام و نام خانوادگی (اختیاری)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="رمز عبور (خالی = کد ملی؛ در اولین ورود تغییر می‌کند)">
          <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="دست‌کم ۸ نویسه" style={{ direction: 'ltr', textAlign: 'right' }} />
        </Field>
        <button onClick={create} disabled={busy || !f.nationalCode || !f.phone || !f.companyId} className="btn btn-primary btn-sm w-full">ثبت نماینده</button>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setFilter('PENDING')} className="btn btn-sm" style={tabStyle(filter === 'PENDING')}>در دست بررسی{pending > 0 ? ` (${pending})` : ''}</button>
          <button onClick={() => setFilter('ALL')} className="btn btn-sm" style={tabStyle(filter === 'ALL')}>همه</button>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{['نام', 'شرکت بیمه‌گزار', 'کد ملی', 'موبایل', 'وضعیت', 'رمز عبور', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>موردی نیست</td></tr> :
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
                    <td>
                      <span className={`badge ${STATUS[r.signupStatus]?.cls || 'badge-neutral'}`}>{STATUS[r.signupStatus]?.label || r.signupStatus}</span>
                      {r.shahkarVerified && <span className="badge badge-success mr-1" title="کد ملی و موبایل در شاهکار تطبیق داده شد">شاهکار ✓</span>}
                    </td>
                    <td className="text-xs">{!r.hasPassword ? '—' : r.mustChangePassword ? <span className="badge badge-warning">کد ملی (پیش‌فرض)</span> : <span className="badge badge-success">تنظیم شده</span>}</td>
                    <td>
                      <span className="flex gap-2">
                        {r.signupStatus !== 'ACTIVE' && <button onClick={() => setStatus(r, 'approve')} className="text-xs" style={{ color: 'var(--success)' }}>{r.signupStatus === 'PENDING' ? 'تایید' : 'فعال‌سازی'}</button>}
                        {r.signupStatus === 'PENDING' && <button onClick={() => setStatus(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }}>رد</button>}
                        {r.signupStatus === 'ACTIVE' && <button onClick={() => setStatus(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }}>تعلیق</button>}
                        {r.hasPassword !== undefined && (r.nationalCode || r.nationalCodeMasked) && <button onClick={() => setPassword(r)} className="text-xs" style={{ color: 'var(--brand)' }}>تعیین رمز</button>}
                        <button onClick={() => remove(r)} className="text-xs" style={{ color: 'var(--danger)' }}>حذف</button>
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
