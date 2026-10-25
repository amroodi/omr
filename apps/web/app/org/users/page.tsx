'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Overlay } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Role { id: string; name: string; permissions: string[]; isSystem: boolean; locked: boolean; users: number }
interface User { id: string; username: string; displayName: string; isActive: boolean; lastLoginAt?: string | null; role: { id: string; name: string } | null; branch?: { id: string; name: string } | null; desk?: string | null }
type Msg = { t: 'ok' | 'err'; m: string } | null;

/** Permission names in Persian, grouped by area (unknown keys fall back to the raw key). */
const PERM_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'پرونده‌های خسارت', items: [
    ['claim:read', 'مشاهدهٔ پرونده‌ها'], ['claim:file', 'ثبت پرونده و بارگذاری مدرک'], ['claim:file-on-behalf', 'ثبت پرونده به جای بیمه‌گزار'],
    ['claim:process', 'اقدام در گردش کار و مبلغ قطعی'], ['claim:override', 'اختیار مدیریت (عودت مستقیم، همهٔ مراحل)'], ['claim:delete', 'حذف پرونده (سطل بازیافت)'],
    ['level:manage', 'تنظیم سطوح و سقف تایید'],
  ] },
  { title: 'مدارک', items: [['doc:upload', 'بارگذاری مدرک'], ['doc:read', 'مشاهدهٔ مدارک'], ['doc:verify', 'تایید/رد مدارک'], ['ocr:run', 'استخراج خودکار (OCR)']] },
  { title: 'پرونده‌های قدیمی و بیمه‌نامه', items: [
    ['case:read', 'مشاهده'], ['case:create', 'ایجاد'], ['case:edit', 'ویرایش'], ['case:delete', 'حذف'], ['policy:read', 'مشاهدهٔ بیمه‌نامه'], ['policy:edit', 'ویرایش بیمه‌نامه'],
  ] },
  { title: 'پرداخت', items: [['payment:propose', 'پیشنهاد پرداخت'], ['payment:approve', 'تایید پرداخت']] },
  { title: 'گزارش و داده', items: [
    ['export:list', 'خروجی اکسل و گزارش'], ['export:pii', 'نمایش کد ملی در خروجی'], ['view:pii', 'نمایش کامل اطلاعات هویتی'], ['import:batch', 'ورود دسته‌ای'],
  ] },
  { title: 'مدیریت سازمان', items: [
    ['customer:manage', 'مدیریت بیمه‌گزاران'], ['user:manage', 'مدیریت کاربران'], ['role:manage', 'مدیریت نقش‌ها'], ['branch:manage', 'مدیریت شعب'],
    ['audit:read', 'مشاهدهٔ سوابق (لاگ)'], ['tenant:settings', 'تنظیمات سازمان'], ['apikey:manage', 'کلیدهای API'],
  ] },
];
const PERM_FA = Object.fromEntries(PERM_GROUPS.flatMap((g) => g.items));
const ADMIN_PERMS = ['user:manage', 'role:manage'];
const seatLabel = (u: User) => u.branch ? `شعبه: ${u.branch.name}` : u.desk === 'COUNCIL' ? 'شورای فنی' : 'مدیریت ستاد';
const seatValue = (u: User) => (u.branch ? `branch:${u.branch.id}` : u.desk === 'COUNCIL' ? 'COUNCIL' : 'HQ');

function MsgBox({ v }: { v: Msg }) { return v ? <div className={v.t === 'ok' ? 'alert-success' : 'alert-error'}>{v.m}</div> : null; }

/** Permission picker: grouped checkboxes; `readOnly` shows them without letting anything change. */
function PermPicker({ catalog, value, onChange, readOnly }: { catalog: string[]; value: Set<string>; onChange?: (s: Set<string>) => void; readOnly?: boolean }) {
  const known = new Set(PERM_GROUPS.flatMap((g) => g.items.map(([k]) => k)));
  const groups = [...PERM_GROUPS.map((g) => ({ ...g, items: g.items.filter(([k]) => catalog.includes(k)) })), { title: 'سایر', items: catalog.filter((k) => !known.has(k)).map((k) => [k, k] as [string, string]) }];
  const toggle = (k: string) => { if (readOnly || !onChange) return; const s = new Set(value); s.has(k) ? s.delete(k) : s.add(k); onChange(s); };
  return (
    <div className="ur-perms">
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title}>
          <div className="ur-perm-g">{g.title}</div>
          {g.items.map(([k, label]) => {
            const blocked = !readOnly && ADMIN_PERMS.includes(k); // admin powers stay with the admin role
            return (
              <label key={k} className={`ur-perm${value.has(k) ? ' is-on' : ''}${readOnly || blocked ? ' is-ro' : ''}`} title={blocked ? 'این مجوز فقط در نقش مدیر سازمان است' : k}>
                <input type="checkbox" checked={value.has(k)} disabled={readOnly || blocked} onChange={() => toggle(k)} /> {label}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * «کاربران و نقش‌ها». Users are edited (name, role, desk/branch, active, password), never deleted, so
 * their past actions stay attributable. Clicking a role shows its permissions; admin roles are
 * preview-only, every other role can be renamed, edited or removed. Every change is audit-logged.
 */
export default function UsersRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isInsurer, setIsInsurer] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);

  // role editor (null = closed; id '' = new role)
  const [re, setRe] = useState<{ id: string; name: string; perms: Set<string>; locked: boolean; users: number } | null>(null);
  const [roleMsg, setRoleMsg] = useState<Msg>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  // user editor / creator
  const [nu, setNu] = useState({ username: '', displayName: '', password: '', roleId: '', seat: 'HQ' });
  const [userMsg, setUserMsg] = useState<Msg>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [ue, setUe] = useState<{ user: User; displayName: string; roleId: string; seat: string; isActive: boolean; password: string } | null>(null);
  const [ueMsg, setUeMsg] = useState<Msg>(null);

  useEffect(() => {
    client.get<{ kind?: string }>('/tenant/branding', 'org').then((b) => {
      if (b.kind !== 'INSURER') return;
      setIsInsurer(true);
      client.get<{ id: string; name: string; code: string }[]>('/branches', 'org').then(setBranches).catch(() => {});
    }).catch(() => {});
  }, []);

  const load = async () => {
    try {
      const [r, u, c] = await Promise.all([
        client.get<Role[]>('/roles', 'org'),
        client.get<User[]>('/users', 'org'),
        client.get<{ key: string }[]>('/roles/catalog', 'org'),
      ]);
      setRoles(r); setUsers(u); setCatalog(c.map((x) => x.key));
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const openRole = (r: Role) => { setRoleMsg(null); setRe({ id: r.id, name: r.name, perms: new Set(r.permissions), locked: r.locked, users: r.users }); };
  const saveRole = async () => {
    if (!re) return;
    setRoleMsg(null);
    if (!re.name.trim()) return setRoleMsg({ t: 'err', m: 'نام نقش را وارد کنید.' });
    if (re.perms.size === 0) return setRoleMsg({ t: 'err', m: 'حداقل یک مجوز را انتخاب کنید.' });
    setRoleBusy(true);
    try {
      const body = { name: re.name.trim(), permissions: [...re.perms] };
      if (re.id) await client.patch(`/roles/${re.id}`, body, 'org'); else await client.post('/roles', body, 'org');
      setRoleMsg({ t: 'ok', m: re.id ? 'تغییرات نقش ذخیره شد.' : 'نقش ساخته شد.' });
      await load();
      if (!re.id) setRe(null);
    } catch (e: any) { setRoleMsg({ t: 'err', m: e.message }); } finally { setRoleBusy(false); }
  };
  const removeRole = async () => {
    if (!re?.id || !window.confirm(`نقش «${re.name}» حذف شود؟`)) return;
    setRoleBusy(true); setRoleMsg(null);
    try { await client.del(`/roles/${re.id}`, 'org'); setRe(null); await load(); }
    catch (e: any) { setRoleMsg({ t: 'err', m: e.message }); } finally { setRoleBusy(false); }
  };

  const createUser = async () => {
    setUserMsg(null);
    if (!nu.username.trim()) return setUserMsg({ t: 'err', m: 'نام کاربری را وارد کنید.' });
    if (nu.password.length < 8) return setUserMsg({ t: 'err', m: 'رمز عبور باید حداقل ۸ نویسه باشد.' });
    if (!nu.roleId) return setUserMsg({ t: 'err', m: 'یک نقش برای کاربر انتخاب کنید.' });
    setUserBusy(true);
    try {
      const payload: Record<string, string> = { username: nu.username.trim(), password: nu.password, roleId: nu.roleId };
      if (isInsurer) { if (nu.seat.startsWith('branch:')) payload.branchId = nu.seat.slice(7); else payload.desk = nu.seat; }
      if (nu.displayName.trim()) payload.displayName = nu.displayName.trim();
      await client.post('/users', payload, 'org');
      setNu({ username: '', displayName: '', password: '', roleId: '', seat: 'HQ' });
      setUserMsg({ t: 'ok', m: 'کاربر با موفقیت ساخته شد.' });
      load();
    } catch (e: any) { setUserMsg({ t: 'err', m: e.message }); } finally { setUserBusy(false); }
  };

  const openUser = (u: User) => { setUeMsg(null); setUe({ user: u, displayName: u.displayName, roleId: u.role?.id ?? '', seat: seatValue(u), isActive: u.isActive, password: '' }); };
  const saveUser = async () => {
    if (!ue) return;
    setUeMsg(null);
    if (ue.password && ue.password.length < 8) return setUeMsg({ t: 'err', m: 'رمز عبور جدید باید حداقل ۸ نویسه باشد.' });
    setUserBusy(true);
    try {
      const body: Record<string, unknown> = { isActive: ue.isActive };
      if (ue.displayName.trim() && ue.displayName.trim() !== ue.user.displayName) body.displayName = ue.displayName.trim();
      if (ue.roleId && ue.roleId !== ue.user.role?.id) body.roleId = ue.roleId;
      if (isInsurer && ue.seat !== seatValue(ue.user)) {
        if (ue.seat.startsWith('branch:')) body.branchId = ue.seat.slice(7); else { body.desk = ue.seat; body.branchId = null; }
      }
      await client.patch(`/users/${ue.user.id}`, body, 'org');
      if (ue.password) await client.post(`/users/${ue.user.id}/reset-password`, { password: ue.password }, 'org');
      setUe(null); await load();
    } catch (e: any) { setUeMsg({ t: 'err', m: e.message }); } finally { setUserBusy(false); }
  };

  const seatOptions = (
    <>
      <option value="HQ">مدیریت ستاد</option>
      <option value="COUNCIL">شورای فنی</option>
      {branches.map((b) => <option key={b.id} value={`branch:${b.id}`}>شعبه: {b.name} ({b.code})</option>)}
    </>
  );

  return (
    <Shell title="کاربران و نقش‌ها" subtitle="مدیریت دسترسی‌ها و اعضای سازمان" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <div className="grid lg:grid-cols-2 gap-5">
        {/* Roles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">نقش‌ها</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setRoleMsg(null); setRe({ id: '', name: '', perms: new Set(), locked: false, users: 0 }); }}>+ نقش جدید</button>
          </div>
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {roles.map((r) => (
              <button key={r.id} type="button" onClick={() => openRole(r)} className="ur-role">
                <span className="text-sm font-semibold">{r.name} {r.locked && <span className="badge badge-neutral">مدیریتی — فقط مشاهده</span>}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{r.permissions.length.toLocaleString('fa-IR')} مجوز · {r.users.toLocaleString('fa-IR')} کاربر ›</span>
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>برای دیدن و تغییر مجوزهای هر نقش روی آن کلیک کنید. همهٔ تغییرات برای مدیر سامانه ثبت می‌شود.</p>
        </div>

        {/* Users */}
        <div className="space-y-3">
          <h2 className="font-bold">کاربران</h2>
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {users.map((u) => (
              <div key={u.id} className="flex justify-between items-center p-3 gap-2 flex-wrap">
                <span className="text-sm font-semibold">{u.displayName} <span style={{ color: 'var(--muted)' }} className="font-normal">({u.username})</span></span>
                <span className="text-xs flex items-center gap-2 flex-wrap">
                  <span style={{ color: 'var(--muted)' }}>{u.role?.name}</span>
                  {isInsurer && <span className="badge badge-neutral">{seatLabel(u)}</span>}
                  {!u.isActive && <span className="badge badge-danger">غیرفعال</span>}
                  <button onClick={() => openUser(u)} className="btn btn-ghost btn-sm">ویرایش</button>
                </span>
              </div>
            ))}
          </div>
          <div className="card p-4 space-y-3">
            <h3 className="font-semibold text-sm">افزودن کاربر</h3>
            <Field label="نام کاربری"><input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} className="input" /></Field>
            <Field label="نام نمایشی (اختیاری)"><input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} className="input" /></Field>
            <div>
              <label className="label">رمز عبور</label>
              <input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} className="input" placeholder="حداقل ۸ نویسه" />
            </div>
            <Field label="نقش">
              <select value={nu.roleId} onChange={(e) => setNu({ ...nu, roleId: e.target.value })} className="input">
                <option value="">— انتخاب نقش —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            {isInsurer && (
              <Field label="محل خدمت در گردش کار پرونده">
                <select value={nu.seat} onChange={(e) => setNu({ ...nu, seat: e.target.value })} className="input">{seatOptions}</select>
              </Field>
            )}
            <MsgBox v={userMsg} />
            <button onClick={createUser} disabled={userBusy} className="btn btn-primary btn-sm">{userBusy ? '…' : 'ساخت کاربر'}</button>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>کاربران حذف نمی‌شوند تا سوابق اقدامات آن‌ها حفظ شود؛ برای قطع دسترسی، کاربر را غیرفعال کنید.</p>
          </div>
        </div>
      </div>

      {/* Role: permissions (editable unless it's an admin role) */}
      {re && (
        <Overlay onClose={() => setRe(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">{re.id ? (re.locked ? `مجوزهای «${re.name}»` : `ویرایش نقش «${re.name}»`) : 'نقش جدید'}</span>
              <button className="pmodal-x" onClick={() => setRe(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3">
              {re.locked && <div className="pinfobox text-sm">این نقش مدیریتی است و فقط قابل مشاهده است تا مجوزهای مدیر به اشتباه تغییر نکند.</div>}
              <Field label="نام نقش"><input className="input" value={re.name} disabled={re.locked} onChange={(e) => setRe({ ...re, name: e.target.value })} /></Field>
              <PermPicker catalog={catalog} value={re.perms} readOnly={re.locked} onChange={(perms) => setRe({ ...re, perms })} />
              <MsgBox v={roleMsg} />
            </div>
            {!re.locked && (
              <div className="ur-modal-btns">
                <button onClick={saveRole} disabled={roleBusy} className="btn btn-primary btn-sm">{roleBusy ? '…' : re.id ? 'ذخیرهٔ تغییرات' : 'ساخت نقش'}</button>
                {re.id && <button onClick={removeRole} disabled={roleBusy || re.users > 0} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} title={re.users > 0 ? 'ابتدا کاربران این نقش را به نقش دیگری منتقل کنید' : 'حذف نقش'}>حذف نقش</button>}
                {re.users > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>{re.users.toLocaleString('fa-IR')} کاربر این نقش را دارند؛ برای حذف ابتدا نقششان را عوض کنید.</span>}
              </div>
            )}
          </div>
        </Overlay>
      )}

      {/* User: edit (no delete) */}
      {ue && (
        <Overlay onClose={() => setUe(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">ویرایش کاربر «{ue.user.username}»</span>
              <button className="pmodal-x" onClick={() => setUe(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-3">
              <Field label="نام نمایشی"><input className="input" value={ue.displayName} onChange={(e) => setUe({ ...ue, displayName: e.target.value })} /></Field>
              <Field label="نقش">
                <select className="input" value={ue.roleId} onChange={(e) => setUe({ ...ue, roleId: e.target.value })}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
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
              <button onClick={saveUser} disabled={userBusy} className="btn btn-primary btn-sm">{userBusy ? '…' : 'ذخیرهٔ تغییرات'}</button>
              <button onClick={() => setUe(null)} className="btn btn-ghost btn-sm">انصراف</button>
            </div>
          </div>
        </Overlay>
      )}
    </Shell>
  );
}
