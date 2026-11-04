'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { ErrorBox, Field, Overlay } from '../ui';
import { Flash } from '../Toaster';

interface Branch { id: string; name: string; code: string }
interface Agent { id: string; fullName: string | null; nationalCode: string; phone: string; branchId: string | null; branchName: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null }
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * «نمایندگان بیمه» of an insurer: its own insurance agents, each tied to one شعبه. They sign in to the
 * insurer's panel 1 («ورود برای بارگذاری مدارک» › نماینده بیمه) with کد ملی + password (first password =
 * کد ملی, changed at first sign-in), file cases for their customers, and «ارسال» sends a case to their
 * شعبه. Add, edit name / mobile, move شعبه, deactivate, reset the password, remove. Used by the insurer's
 * admin (`base` = '') and by Super Admin (`base` = '/admin/operators/<id>').
 */
export function AgentsPanel({ realm, base }: { realm: 'org' | 'super'; base: string }) {
  const [data, setData] = useState<{ branches: Branch[]; agents: Agent[] } | null>(null);
  const [f, setF] = useState({ fullName: '', nationalCode: '', phone: '', branchId: '' });
  const [edit, setEdit] = useState<{ a: Agent; fullName: string; phone: string } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => client.get<{ branches: Branch[]; agents: Agent[] }>(`${base}/customer/agents`, realm).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [base]);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setError(''); setMsg(''); setBusy(true);
    try { const r = await fn(); setMsg(r?.message || ok); await load(); return true; } catch (e: any) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const add = () => act(async () => {
    await client.post(`${base}/customer/agents`, { fullName: f.fullName.trim(), nationalCode: toAscii(f.nationalCode).trim(), phone: toAscii(f.phone).trim(), branchId: f.branchId }, realm);
    setF({ fullName: '', nationalCode: '', phone: '', branchId: f.branchId });
  }, 'نماینده افزوده شد؛ نخستین رمز عبور کد ملی اوست.');
  const saveEdit = async () => {
    if (!edit) return;
    const body: Record<string, string> = {};
    if (edit.fullName.trim() && edit.fullName.trim() !== (edit.a.fullName ?? '')) body.fullName = edit.fullName.trim();
    const phone = toAscii(edit.phone).trim();
    if (phone && phone !== edit.a.phone) body.phone = phone;
    if (!Object.keys(body).length) return setEdit(null);
    if (await act(() => client.patch(`${base}/customer/agents/${edit.a.id}`, body, realm), 'مشخصات نماینده ذخیره شد.')) setEdit(null);
  };
  // A masked number («•••») is shown when the viewer can't see full PII; then the field starts empty.
  const editable = (v: string) => (v.includes('•') ? '' : v);

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <Flash id={msg} text={msg} ok />
      <section className="card p-4 space-y-3">
        <h2 className="font-bold">افزودن نماینده بیمه</h2>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>نماینده با کد ملی و رمز عبور از «ورود برای بارگذاری مدارک › نماینده بیمه» وارد پنل ۱ این بیمه‌گر می‌شود، برای مشتریان خود پرونده ثبت می‌کند و با «ارسال»، پرونده به شعبهٔ او می‌رود.</p>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="نام و نام خانوادگی"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label="کد ملی"><input className="input latin-digits" value={f.nationalCode} onChange={(e) => setF({ ...f, nationalCode: e.target.value })} inputMode="numeric" maxLength={10} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="شمارهٔ همراه"><input className="input latin-digits" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="شعبه">
            <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>
              <option value="">— انتخاب شعبه —</option>
              {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </Field>
        </div>
        {data && !data.branches.length && <p className="text-xs" style={{ color: 'var(--danger)' }}>این بیمه‌گر هنوز شعبه‌ای ندارد؛ هر نماینده به یک شعبه وصل است.</p>}
        <button className="btn btn-primary btn-sm" disabled={busy || f.fullName.trim().length < 2 || !f.nationalCode.trim() || !f.phone.trim() || !f.branchId} onClick={add}>افزودن نماینده</button>
      </section>

      <section className="card p-0 overflow-x-auto">
        <table className="table w-full text-sm">
          <thead><tr><th>نام</th><th>کد ملی</th><th>همراه</th><th>شعبه</th><th>آخرین ورود</th><th>وضعیت</th><th /></tr></thead>
          <tbody>
            {!data ? <tr><td colSpan={7} className="text-center py-6">…</td></tr>
              : !data.agents.length ? <tr><td colSpan={7} className="text-center py-6" style={{ color: 'var(--muted)' }}>هنوز نماینده‌ای ثبت نشده است.</td></tr>
              : data.agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.fullName || '—'}</td>
                  <td><bdi className="latin-digits">{a.nationalCode}</bdi></td>
                  <td><bdi className="latin-digits">{a.phone || '—'}</bdi></td>
                  <td>
                    <select className="input" style={{ minWidth: 150 }} value={a.branchId ?? ''} disabled={busy} onChange={(e) => e.target.value && act(() => client.patch(`${base}/customer/agents/${a.id}`, { branchId: e.target.value }, realm), 'شعبهٔ نماینده تغییر کرد.')}>
                      {!a.branchId && <option value="">— بدون شعبه —</option>}
                      {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                    </select>
                  </td>
                  <td>{a.lastLoginAt || '—'}</td>
                  <td>{a.isActive ? <span className="badge badge-success">فعال</span> : <span className="badge badge-neutral">غیرفعال</span>}{a.mustChangePassword && <span className="badge badge-warning mr-1">رمز اولیه</span>}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEdit({ a, fullName: a.fullName ?? '', phone: editable(a.phone) })}>ویرایش</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.patch(`${base}/customer/agents/${a.id}`, { active: !a.isActive }, realm), a.isActive ? 'نماینده غیرفعال شد.' : 'نماینده فعال شد.')}>{a.isActive ? 'غیرفعال' : 'فعال'}</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.post(`${base}/customer/accounts/${a.id}/password`, {}, realm), 'رمز عبور به کد ملی بازنشانی شد.')}>بازنشانی رمز</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => window.confirm(`حذف «${a.fullName || 'نماینده'}»؟ پرونده‌هایی که ثبت کرده می‌مانند.`) && act(() => client.del(`${base}/customer/accounts/${a.id}`, realm), 'نماینده حذف شد.')}>حذف</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {edit && (
        <Overlay onClose={() => setEdit(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">ویرایش نماینده بیمه</span>
              <button className="pmodal-x" onClick={() => setEdit(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>کد ملی نام کاربری نماینده است و تغییر نمی‌کند: <bdi className="latin-digits">{edit.a.nationalCode}</bdi></p>
              <Field label="نام و نام خانوادگی"><input className="input" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
              <Field label={edit.phone ? 'شمارهٔ همراه' : 'شمارهٔ همراه تازه (خالی = بدون تغییر)'}>
                <input className="input latin-digits" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} inputMode="numeric" maxLength={11} placeholder={edit.a.phone || '۰۹۱۲…'} style={{ direction: 'ltr', textAlign: 'right' }} />
              </Field>
              <ErrorBox message={error} />
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
