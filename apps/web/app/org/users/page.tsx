'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field, Overlay } from '../../components/ui';
import { StaffPanel } from '../../components/operators/StaffPanel';
import { ORG_NAV } from '../nav';

interface Role { id: string; name: string; permissions: string[]; isSystem: boolean; locked: boolean; users: number }
type Msg = { t: 'ok' | 'err'; m: string } | null;

/** Permission names in Persian, grouped by area (unknown keys fall back to the raw key). */
const PERM_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'پرونده‌های خسارت', items: [
    ['claim:read', 'مشاهدهٔ پرونده‌ها'], ['claim:file', 'ثبت پرونده و بارگذاری مدرک'], ['claim:file-on-behalf', 'ثبت پرونده به جای بیمه‌گزار'],
    ['claim:process', 'اقدام در گردش کار و مبلغ قطعی'], ['claim:override', 'اختیار مدیریت (عودت مستقیم، همهٔ مراحل)'], ['claim:delete', 'حذف پرونده (سطل بازیافت)'],
    ['level:manage', 'تنظیم سطوح و سقف تایید'],
  ] },
  { title: 'مدارک', items: [['doc:upload', 'بارگذاری مدرک'], ['doc:read', 'مشاهدهٔ مدارک'], ['doc:verify', 'تایید/رد مدارک'], ['ocr:run', 'استخراج خودکار (OCR)']] },
  { title: 'میز کار مستقل', items: [['spare:work', 'کار با میز کار مستقل (فقط وقتی مدیر سامانه فعال کرده باشد)']] },
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
// Roles that can create cases sign in to panel 1 («ورود برای بارگذاری مدارک» › کارکنان سازمان).
const ENTRY_PERMS = ['claim:file', 'claim:file-on-behalf', 'import:batch', 'spare:work'];

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
 * «کاربران و نقش‌ها»: the organization's staff (کارکنان سازمان — panel 1 and panel 2, see StaffPanel) and
 * its roles. Clicking a role shows its permissions; admin roles are preview-only, every other role can be
 * renamed, edited or removed. A role that can create cases opens panel 1. Every change is audit-logged.
 */
export default function UsersRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isInsurer, setIsInsurer] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);

  // role editor (null = closed; id '' = new role)
  const [re, setRe] = useState<{ id: string; name: string; perms: Set<string>; locked: boolean; users: number } | null>(null);
  const [roleMsg, setRoleMsg] = useState<Msg>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  useEffect(() => {
    client.get<{ kind?: string }>('/tenant/branding', 'org').then((b) => {
      if (b.kind !== 'INSURER') return;
      setIsInsurer(true);
      client.get<{ id: string; name: string; code: string }[]>('/branches', 'org').then(setBranches).catch(() => {});
    }).catch(() => {});
  }, []);

  const load = async () => {
    try {
      const [r, c] = await Promise.all([
        client.get<Role[]>('/roles', 'org'),
        client.get<{ key: string }[]>('/roles/catalog', 'org'),
      ]);
      setRoles(r); setCatalog(c.map((x) => x.key));
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
                <span className="text-sm font-semibold">{r.name} {r.locked && <span className="badge badge-neutral">مدیریتی — فقط مشاهده</span>}{r.permissions.some((p) => ENTRY_PERMS.includes(p)) && <span className="badge badge-warning mr-1" title="کاربران این نقش به پنل ۱ (ثبت پرونده) هم وارد می‌شوند">پنل ۱</span>}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{r.permissions.length.toLocaleString('fa-IR')} مجوز · {r.users.toLocaleString('fa-IR')} کاربر ›</span>
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>برای دیدن و تغییر مجوزهای هر نقش روی آن کلیک کنید. همهٔ تغییرات برای مدیر سامانه ثبت می‌شود.</p>
        </div>

        {/* Users: the organization's staff (panel 1 and panel 2) */}
        <StaffPanel realm="org" base="" isInsurer={isInsurer} branches={branches} onChanged={load}
          roles={roles.map((r) => ({ id: r.id, name: r.name, entry: r.permissions.some((p) => ENTRY_PERMS.includes(p)) }))} />
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

    </Shell>
  );
}
