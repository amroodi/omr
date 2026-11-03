'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Field, Overlay } from '../ui';

interface Acc {
  id: string; fullName: string | null; nationalCode: string | null; nationalCodeMasked: string | null; phone: string | null; phoneMasked: string | null;
  canViewPii: boolean; signupStatus: string; isActive: boolean; company: { id: string; name: string } | null;
  hasPassword?: boolean; mustChangePassword?: boolean; shahkarVerified?: boolean; lastLoginAt?: string | null;
}
interface Company { id: string; name: string; isActive: boolean }
type Msg = { t: 'ok' | 'err'; m: string } | null;

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'در دست بررسی', cls: 'badge-warning' },
  ACTIVE: { label: 'فعال', cls: 'badge-success' },
  REJECTED: { label: 'غیرفعال / ردشده', cls: 'badge-neutral' },
};
const chip = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * «نمایندگان» of a brokerage's بیمه‌گزار companies: people who sign in to panel 1 («ورود برای بارگذاری
 * مدارک» › بیمه‌گزار / نماینده) with کد ملی + password and file cases for their company. Add, edit name /
 * mobile, suspend, set the password, move to another company, remove. Used by the brokerage's admin
 * (`base` = '') and by Super Admin (`base` = '/admin/operators/<id>').
 */
export function RepresentativesPanel({ realm, base }: { realm: 'org' | 'super'; base: string }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<Acc[] | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'PENDING'>('ALL');
  const [pending, setPending] = useState(0);
  const [f, setF] = useState({ nationalCode: '', phone: '', fullName: '', companyId: '', password: '' });
  const [edit, setEdit] = useState<{ acc: Acc; fullName: string; phone: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    client.get<Acc[]>(`${base}/customer/accounts${filter === 'PENDING' ? '?status=PENDING' : ''}`, realm).then(setRows).catch((e) => setMsg({ t: 'err', m: e.message }));
    client.get<{ count: number }>(`${base}/customer/accounts/pending-count`, realm).then((d) => setPending(d.count)).catch(() => {});
  };
  useEffect(() => { client.get<Company[]>(`${base}/policyholder-companies`, realm).then(setCompanies).catch(() => setCompanies([])); }, [base, realm]);
  useEffect(() => { setRows(null); load(); /* eslint-disable-next-line */ }, [filter, base]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setMsg(null); setBusy(true);
    try { const r = await fn(); setMsg({ t: 'ok', m: r?.message || ok }); load(); return true; } catch (e: any) { setMsg({ t: 'err', m: e.message }); return false; } finally { setBusy(false); }
  };
  const name = (r: Acc) => r.fullName || r.nationalCode || r.nationalCodeMasked || 'نماینده';

  const create = () => act(async () => {
    await client.post(`${base}/customer/accounts`, { nationalCode: toAscii(f.nationalCode).trim(), phone: toAscii(f.phone).trim(), companyId: f.companyId || undefined, fullName: f.fullName.trim() || undefined, password: f.password || undefined }, realm);
    setF({ nationalCode: '', phone: '', fullName: '', companyId: f.companyId, password: '' });
  }, f.password ? 'نماینده ثبت شد.' : 'نماینده ثبت شد؛ رمز عبور اولیه همان کد ملی است.');
  const status = (r: Acc, action: 'approve' | 'reject') => {
    const verb = action === 'approve' ? 'فعال‌سازی' : r.signupStatus === 'ACTIVE' ? 'تعلیق (غیرفعال‌سازی)' : 'رد';
    if (window.confirm(`${verb} «${name(r)}»؟`)) act(() => client.post(`${base}/customer/accounts/${r.id}/${action}`, {}, realm), 'وضعیت تغییر کرد.');
  };
  const password = (r: Acc) => {
    const pw = window.prompt(`رمز عبور تازهٔ «${name(r)}» (دست‌کم ۸ نویسه).\nخالی بگذارید تا رمز به کد ملی بازنشانی شود:`, '');
    if (pw !== null) act(() => client.post(`${base}/customer/accounts/${r.id}/password`, { password: pw.trim() || undefined }, realm), 'رمز عبور تنظیم شد.');
  };
  const remove = (r: Acc) => {
    if (window.confirm(`«${name(r)}» از نمایندگان حذف شود؟\nدیگر نمی‌تواند وارد پنل ۱ شود؛ پرونده‌هایی که ثبت کرده برای شرکت باقی می‌مانند.`)) act(() => client.del(`${base}/customer/accounts/${r.id}`, realm), 'نماینده حذف شد.');
  };
  const assign = (r: Acc, companyId: string) => act(() => client.put(`${base}/policyholder-companies/accounts/${r.id}`, { companyId: companyId || null }, realm), 'شرکت نماینده تغییر کرد.');
  const saveEdit = async () => {
    if (!edit) return;
    const body: Record<string, string> = {};
    if (edit.fullName.trim() !== (edit.acc.fullName ?? '')) body.fullName = edit.fullName.trim();
    const phone = toAscii(edit.phone).trim();
    if (phone && phone !== (edit.acc.phone ?? '')) body.phone = phone;
    if (!Object.keys(body).length) return setEdit(null);
    if (await act(() => client.patch(`${base}/customer/accounts/${edit.acc.id}`, body, realm), 'مشخصات نماینده ذخیره شد.')) setEdit(null);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
      <div className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-sm">افزودن نماینده</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>نماینده با کد ملی (نام کاربری) و رمز عبور از «ورود برای بارگذاری مدارک › بیمه‌گزار / نماینده» وارد پنل ۱ می‌شود و برای شرکت خود پرونده ثبت و مدارک بارگذاری می‌کند.</p>
        <Field label="شرکت بیمه‌گزار *">
          <select className="input" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">— انتخاب شرکت —</option>
            {companies.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="کد ملی"><input className="input" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="موبایل"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
        <Field label="نام و نام خانوادگی (اختیاری)"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="رمز عبور (خالی = کد ملی؛ در اولین ورود تغییر می‌کند)">
          <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="دست‌کم ۸ نویسه" style={{ direction: 'ltr', textAlign: 'right' }} />
        </Field>
        <button onClick={create} disabled={busy || !f.nationalCode || !f.phone || !f.companyId} className="btn btn-primary btn-sm w-full">ثبت نماینده</button>
      </div>

      <div className="space-y-3">
        {msg && <div className={msg.t === 'ok' ? 'alert-success' : 'alert-error'}>{msg.m}</div>}
        <div className="flex gap-2">
          <button onClick={() => setFilter('PENDING')} className="btn btn-sm" style={chip(filter === 'PENDING')}>در دست بررسی{pending > 0 ? ` (${pending.toLocaleString('fa-IR')})` : ''}</button>
          <button onClick={() => setFilter('ALL')} className="btn btn-sm" style={chip(filter === 'ALL')}>همه</button>
        </div>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr>{['نام', 'شرکت بیمه‌گزار', 'کد ملی', 'موبایل', 'وضعیت', 'رمز عبور', 'اقدام'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {!rows ? <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>در حال دریافت…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--muted)' }}>موردی نیست</td></tr>
                : rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.fullName || '—'}</td>
                    <td>
                      <select className="input" style={{ minWidth: 170, padding: '4px 8px' }} value={r.company?.id ?? ''} disabled={busy} onChange={(e) => assign(r, e.target.value)}>
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
                      <span className="flex gap-2 flex-wrap">
                        <button onClick={() => setEdit({ acc: r, fullName: r.fullName ?? '', phone: r.phone ?? '' })} className="text-xs" style={{ color: 'var(--brand)' }} disabled={busy}>ویرایش</button>
                        {r.signupStatus !== 'ACTIVE' && <button onClick={() => status(r, 'approve')} className="text-xs" style={{ color: 'var(--success)' }} disabled={busy}>{r.signupStatus === 'PENDING' ? 'تایید' : 'فعال‌سازی'}</button>}
                        {r.signupStatus === 'PENDING' && <button onClick={() => status(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }} disabled={busy}>رد</button>}
                        {r.signupStatus === 'ACTIVE' && <button onClick={() => status(r, 'reject')} className="text-xs" style={{ color: 'var(--danger)' }} disabled={busy}>تعلیق</button>}
                        {r.hasPassword !== undefined && <button onClick={() => password(r)} className="text-xs" style={{ color: 'var(--brand)' }} disabled={busy}>تعیین رمز</button>}
                        <button onClick={() => remove(r)} className="text-xs" style={{ color: 'var(--danger)' }} disabled={busy}>حذف</button>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <Overlay onClose={() => setEdit(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">ویرایش نماینده</span>
              <button className="pmodal-x" onClick={() => setEdit(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>کد ملی نام کاربری نماینده است و تغییر نمی‌کند: <bdi className="latin-digits">{edit.acc.nationalCode || edit.acc.nationalCodeMasked}</bdi></p>
              <Field label="نام و نام خانوادگی"><input className="input" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
              <Field label={edit.acc.phone ? 'موبایل' : 'موبایل تازه (خالی = بدون تغییر)'}>
                <input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder={edit.acc.phoneMasked || '۰۹۱۲…'} style={{ direction: 'ltr', textAlign: 'right' }} />
              </Field>
              {msg?.t === 'err' && <div className="alert-error">{msg.m}</div>}
            </div>
            <div className="ur-modal-btns">
              <button onClick={saveEdit} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'ذخیره'}</button>
              <button onClick={() => setEdit(null)} className="btn btn-ghost btn-sm">انصراف</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
