'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Field, Overlay } from '../ui';
import { Flash } from '../Toaster';

export interface StaffRole { id: string; name: string; entry: boolean }
export interface StaffBranch { id: string; name: string; code: string }
interface User {
  id: string; username: string; displayName: string; isActive: boolean; lastLoginAt?: string | null;
  role: { id: string; name: string } | null; branch?: { id: string; name: string } | null; desk?: string | null;
  phone?: string | null; mfaEnabled?: boolean; entry?: boolean;
}
type Msg = { t: 'ok' | 'err'; m: string } | null;

const seatLabel = (u: User) => (u.branch ? `شعبه: ${u.branch.name}` : u.desk === 'COUNCIL' ? 'شورای فنی' : 'مدیریت ستاد');
const seatValue = (u: User) => (u.branch ? `branch:${u.branch.id}` : u.desk === 'COUNCIL' ? 'COUNCIL' : 'HQ');
const MsgBox = ({ v }: { v: Msg }) => <Flash id={v} text={v?.m} ok={v?.t === 'ok'} />; // a toast at the top of the screen

/** Roles grouped: the ones that open panel 1 (ثبت پرونده) first. */
function RoleOptions({ roles }: { roles: StaffRole[] }) {
  const entry = roles.filter((r) => r.entry);
  const other = roles.filter((r) => !r.entry);
  return (
    <>
      {entry.length > 0 && <optgroup label="نقش‌هایی که به پنل ۱ (ثبت پرونده) وارد می‌شوند">{entry.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
      {other.length > 0 && <optgroup label="نقش‌های فقط پنل ۲ (رسیدگی)">{other.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>}
    </>
  );
}

/**
 * «کارکنان سازمان»: an organization's own staff — add, edit (name, mobile, role, desk/branch, active,
 * password, two-step reset) and remove. A user whose role can create cases signs in to panel 1 («ورود برای
 * بارگذاری مدارک» › کارکنان سازمان) as well as panel 2. Removal hides the user and ends their sessions; the
 * record stays so their past actions remain attributable. Used by the organization's admin in panel 2
 * (`base` = '') and by Super Admin for any organization (`base` = '/admin/operators/<id>').
 */
export function StaffPanel({ realm, base, roles, branches, isInsurer, onChanged }: {
  realm: 'org' | 'super'; base: string; roles: StaffRole[]; branches: StaffBranch[]; isInsurer: boolean; onChanged?: () => void;
}) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ENTRY'>('ALL');
  const [nu, setNu] = useState({ username: '', displayName: '', password: '', roleId: '', seat: 'HQ', phone: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [ue, setUe] = useState<{ user: User; displayName: string; roleId: string; seat: string; isActive: boolean; password: string; phone: string } | null>(null);
  const [ueMsg, setUeMsg] = useState<Msg>(null);

  const load = () => client.get<User[]>(`${base}/users`, realm).then(setUsers).catch((e) => setMsg({ t: 'err', m: e.message }));
  useEffect(() => { setUsers(null); load(); /* eslint-disable-next-line */ }, [base]);
  const changed = async () => { await load(); onChanged?.(); };

  const create = async () => {
    setMsg(null);
    if (!nu.username.trim()) return setMsg({ t: 'err', m: 'نام کاربری را وارد کنید.' });
    if (nu.password.length < 8) return setMsg({ t: 'err', m: 'رمز عبور باید حداقل ۸ نویسه باشد.' });
    if (!nu.roleId) return setMsg({ t: 'err', m: 'یک نقش برای کاربر انتخاب کنید.' });
    setBusy(true);
    try {
      const payload: Record<string, string> = { username: nu.username.trim(), password: nu.password, roleId: nu.roleId };
      if (isInsurer) { if (nu.seat.startsWith('branch:')) payload.branchId = nu.seat.slice(7); else payload.desk = nu.seat; }
      if (nu.displayName.trim()) payload.displayName = nu.displayName.trim();
      if (nu.phone.trim()) payload.phone = nu.phone.trim();
      await client.post(`${base}/users`, payload, realm);
      setNu({ username: '', displayName: '', password: '', roleId: '', seat: 'HQ', phone: '' });
      setMsg({ t: 'ok', m: 'کاربر ساخته شد.' });
      await changed();
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };

  const open = (u: User) => { setUeMsg(null); setUe({ user: u, displayName: u.displayName, roleId: u.role?.id ?? '', seat: seatValue(u), isActive: u.isActive, password: '', phone: u.phone ?? '' }); };
  const save = async () => {
    if (!ue) return;
    setUeMsg(null);
    if (ue.password && ue.password.length < 8) return setUeMsg({ t: 'err', m: 'رمز عبور جدید باید حداقل ۸ نویسه باشد.' });
    setBusy(true);
    try {
      const body: Record<string, unknown> = { isActive: ue.isActive };
      if (ue.displayName.trim() && ue.displayName.trim() !== ue.user.displayName) body.displayName = ue.displayName.trim();
      if (ue.roleId && ue.roleId !== ue.user.role?.id) body.roleId = ue.roleId;
      if (ue.phone.trim() !== (ue.user.phone ?? '')) body.phone = ue.phone.trim();
      if (isInsurer && ue.seat !== seatValue(ue.user)) {
        if (ue.seat.startsWith('branch:')) body.branchId = ue.seat.slice(7); else { body.desk = ue.seat; body.branchId = null; }
      }
      await client.patch(`${base}/users/${ue.user.id}`, body, realm);
      if (ue.password) await client.post(`${base}/users/${ue.user.id}/reset-password`, { password: ue.password }, realm);
      setUe(null); setMsg({ t: 'ok', m: 'تغییرات کاربر ذخیره شد.' }); await changed();
    } catch (e: any) { setUeMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!ue) return;
    if (!window.confirm(`«${ue.user.displayName}» (${ue.user.username}) حذف شود؟\nدیگر نمی‌تواند وارد شود و نشست‌های بازش همین حالا بسته می‌شود؛ سوابق اقدامات او روی پرونده‌ها باقی می‌ماند.`)) return;
    setBusy(true); setUeMsg(null);
    try { await client.del(`${base}/users/${ue.user.id}`, realm); setUe(null); setMsg({ t: 'ok', m: 'کاربر حذف شد.' }); await changed(); }
    catch (e: any) { setUeMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const resetMfa = async () => {
    if (!ue || !window.confirm('ورود دومرحله‌ای این کاربر بازنشانی شود؟ (مثلاً گوشی را گم کرده است) — باید دوباره راه‌اندازی کند.')) return;
    try { await client.post(`${base}/users/${ue.user.id}/mfa-reset`, {}, realm); setUe({ ...ue, user: { ...ue.user, mfaEnabled: false } }); load(); }
    catch (e: any) { setUeMsg({ t: 'err', m: e.message }); }
  };

  const seatOptions = (
    <>
      <option value="HQ">مدیریت ستاد</option>
      <option value="COUNCIL">شورای فنی</option>
      {branches.map((b) => <option key={b.id} value={`branch:${b.id}`}>شعبه: {b.name} ({b.code})</option>)}
    </>
  );
  const shown = (users ?? []).filter((u) => filter === 'ALL' || u.entry);
  const entryCount = (users ?? []).filter((u) => u.entry).length;
  const chip = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold">کارکنان سازمان</h2>
        <div className="flex gap-2">
          <button className="btn btn-sm" style={chip(filter === 'ALL')} onClick={() => setFilter('ALL')}>همه ({(users?.length ?? 0).toLocaleString('fa-IR')})</button>
          <button className="btn btn-sm" style={chip(filter === 'ENTRY')} onClick={() => setFilter('ENTRY')}>کارکنان پنل ۱ ({entryCount.toLocaleString('fa-IR')})</button>
        </div>
      </div>
      <MsgBox v={msg} />
      <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
        {!users ? <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>در حال دریافت…</div>
          : !shown.length ? <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>کاربری نیست.</div>
          : shown.map((u) => (
            <div key={u.id} className="flex justify-between items-center p-3 gap-2 flex-wrap">
              <span className="text-sm font-semibold">{u.displayName} <span style={{ color: 'var(--muted)' }} className="font-normal">({u.username})</span></span>
              <span className="text-xs flex items-center gap-2 flex-wrap">
                <span style={{ color: 'var(--muted)' }}>{u.role?.name}</span>
                {u.entry && <span className="badge badge-warning" title="با «ورود برای بارگذاری مدارک › کارکنان سازمان» وارد پنل ۱ می‌شود و پرونده ثبت می‌کند">پنل ۱</span>}
                {isInsurer && <span className="badge badge-neutral">{seatLabel(u)}</span>}
                {!u.isActive && <span className="badge badge-danger">غیرفعال</span>}
                {u.mfaEnabled && <span className="badge badge-success" title="ورود دومرحله‌ای فعال است">دومرحله‌ای</span>}
                <button onClick={() => open(u)} className="btn btn-ghost btn-sm">ویرایش</button>
              </span>
            </div>
          ))}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm">افزودن کاربر</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          برای کارمندی که فقط در پنل ۱ (ورود برای بارگذاری مدارک) پرونده ثبت می‌کند، نقش «کارمند ثبت پرونده (پنل ۱)» را انتخاب کنید؛
          نقش‌های گروه دوم فقط به پنل ۲ (رسیدگی) وارد می‌شوند.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="نام کاربری"><input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} className="input" autoComplete="off" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="نام نمایشی (اختیاری)"><input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} className="input" /></Field>
          <Field label="شمارهٔ همراه (اختیاری)"><input value={nu.phone} onChange={(e) => setNu({ ...nu, phone: e.target.value })} className="input" inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="رمز عبور"><input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} className="input" placeholder="حداقل ۸ نویسه" autoComplete="new-password" /></Field>
          <Field label="نقش">
            <select value={nu.roleId} onChange={(e) => setNu({ ...nu, roleId: e.target.value })} className="input">
              <option value="">— انتخاب نقش —</option>
              <RoleOptions roles={roles} />
            </select>
          </Field>
          {isInsurer && (
            <Field label="محل خدمت در گردش کار پرونده">
              <select value={nu.seat} onChange={(e) => setNu({ ...nu, seat: e.target.value })} className="input">{seatOptions}</select>
            </Field>
          )}
        </div>
        <button onClick={create} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'ساخت کاربر'}</button>
      </div>

      {ue && (
        <Overlay onClose={() => setUe(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">ویرایش کاربر «{ue.user.username}»</span>
              <button className="pmodal-x" onClick={() => setUe(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3">
              <Field label="نام نمایشی"><input className="input" value={ue.displayName} onChange={(e) => setUe({ ...ue, displayName: e.target.value })} /></Field>
              <Field label="شمارهٔ همراه"><input className="input" value={ue.phone} onChange={(e) => setUe({ ...ue, phone: e.target.value })} inputMode="numeric" placeholder="۰۹۱۲…" style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              {ue.user.mfaEnabled && (
                <div className="flex items-center justify-between gap-2 text-sm rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                  <span>ورود دومرحله‌ای این کاربر فعال است.</span>
                  <button type="button" className="text-xs underline" style={{ color: 'var(--danger)' }} onClick={resetMfa}>بازنشانی</button>
                </div>
              )}
              <Field label="نقش">
                <select className="input" value={ue.roleId} onChange={(e) => setUe({ ...ue, roleId: e.target.value })}><RoleOptions roles={roles} /></select>
              </Field>
              {isInsurer && (
                <Field label="محل خدمت در گردش کار پرونده">
                  <select className="input" value={ue.seat} onChange={(e) => setUe({ ...ue, seat: e.target.value })}>{seatOptions}</select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={ue.isActive} onChange={(e) => setUe({ ...ue, isActive: e.target.checked })} /> حساب فعال است
              </label>
              <Field label="رمز عبور جدید (اختیاری)">
                <input type="password" className="input" value={ue.password} onChange={(e) => setUe({ ...ue, password: e.target.value })} placeholder="خالی بماند = بدون تغییر — حداقل ۸ نویسه" autoComplete="new-password" />
              </Field>
              <MsgBox v={ueMsg} />
            </div>
            <div className="ur-modal-btns">
              <button onClick={save} disabled={busy} className="btn btn-primary btn-sm">{busy ? '…' : 'ذخیرهٔ تغییرات'}</button>
              <button onClick={() => setUe(null)} className="btn btn-ghost btn-sm">انصراف</button>
              <button onClick={remove} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginInlineStart: 'auto' }}>حذف کاربر</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
