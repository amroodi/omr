'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, Field } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Role { id: string; name: string; permissions: string[]; isSystem: boolean }
interface User { id: string; username: string; displayName: string; isActive: boolean; role: { name: string } | null }

export default function UsersRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [roleMsg, setRoleMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  const [nu, setNu] = useState({ username: '', displayName: '', password: '', roleId: '' });
  const [userMsg, setUserMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [userBusy, setUserBusy] = useState(false);

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

  const createRole = async () => {
    setRoleMsg(null);
    if (!roleName.trim()) return setRoleMsg({ t: 'err', m: 'نام نقش را وارد کنید.' });
    if (rolePerms.size === 0) return setRoleMsg({ t: 'err', m: 'حداقل یک مجوز را انتخاب کنید.' });
    setRoleBusy(true);
    try {
      await client.post('/roles', { name: roleName.trim(), permissions: [...rolePerms] }, 'org');
      setRoleName(''); setRolePerms(new Set());
      setRoleMsg({ t: 'ok', m: 'نقش با موفقیت ساخته شد.' });
      load();
    } catch (e: any) { setRoleMsg({ t: 'err', m: e.message }); } finally { setRoleBusy(false); }
  };

  const createUser = async () => {
    setUserMsg(null);
    if (!nu.username.trim()) return setUserMsg({ t: 'err', m: 'نام کاربری را وارد کنید.' });
    if (nu.password.length < 8) return setUserMsg({ t: 'err', m: 'رمز عبور باید حداقل ۸ نویسه باشد.' });
    if (!nu.roleId) return setUserMsg({ t: 'err', m: 'یک نقش برای کاربر انتخاب کنید.' });
    setUserBusy(true);
    try {
      const payload: Record<string, string> = { username: nu.username.trim(), password: nu.password, roleId: nu.roleId };
      if (nu.displayName.trim()) payload.displayName = nu.displayName.trim();
      await client.post('/users', payload, 'org');
      setNu({ username: '', displayName: '', password: '', roleId: '' });
      setUserMsg({ t: 'ok', m: 'کاربر با موفقیت ساخته شد.' });
      load();
    } catch (e: any) { setUserMsg({ t: 'err', m: e.message }); } finally { setUserBusy(false); }
  };

  const toggle = (p: string) => { const s = new Set(rolePerms); s.has(p) ? s.delete(p) : s.add(p); setRolePerms(s); };
  const Msg = ({ v }: { v: { t: 'ok' | 'err'; m: string } | null }) => v ? <div className={v.t === 'ok' ? 'alert-success' : 'alert-error'}>{v.m}</div> : null;

  return (
    <Shell title="کاربران و نقش‌ها" subtitle="مدیریت دسترسی‌ها و اعضای سازمان" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <div className="grid lg:grid-cols-2 gap-5">
        {/* Roles */}
        <div className="space-y-3">
          <h2 className="font-bold">نقش‌ها</h2>
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {roles.map((r) => (
              <div key={r.id} className="flex justify-between items-center p-3">
                <span className="text-sm font-semibold">{r.name} {r.isSystem && <span className="badge badge-neutral">سیستمی</span>}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{r.permissions.length} مجوز</span>
              </div>
            ))}
          </div>
          <div className="card p-4 space-y-3">
            <h3 className="font-semibold text-sm">ساخت نقش جدید</h3>
            <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="نام نقش" className="input" />
            <div>
              <div className="label">مجوزها {rolePerms.size > 0 && <span style={{ color: 'var(--brand)' }}>({rolePerms.size} انتخاب‌شده)</span>}</div>
              <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
                {catalog.map((p) => (
                  <button key={p} type="button" onClick={() => toggle(p)} className="badge" style={rolePerms.has(p) ? { background: 'var(--brand)', color: '#fff', cursor: 'pointer' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <Msg v={roleMsg} />
            <button onClick={createRole} disabled={roleBusy} className="btn btn-primary btn-sm">{roleBusy ? '…' : 'ساخت نقش'}</button>
          </div>
        </div>

        {/* Users */}
        <div className="space-y-3">
          <h2 className="font-bold">کاربران</h2>
          <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
            {users.map((u) => (
              <div key={u.id} className="flex justify-between items-center p-3">
                <span className="text-sm font-semibold">{u.displayName} <span style={{ color: 'var(--muted)' }} className="font-normal">({u.username})</span></span>
                <span className="text-xs flex items-center gap-2">
                  <span style={{ color: 'var(--muted)' }}>{u.role?.name}</span>
                  {!u.isActive && <span className="badge badge-danger">غیرفعال</span>}
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
              <div className="text-xs mt-1" style={{ color: nu.password && nu.password.length < 8 ? 'var(--danger)' : 'var(--muted)' }}>
                {nu.password.length < 8 ? `حداقل ۸ نویسه (${nu.password.length}/۸)` : 'رمز عبور معتبر است'}
              </div>
            </div>
            <Field label="نقش">
              <select value={nu.roleId} onChange={(e) => setNu({ ...nu, roleId: e.target.value })} className="input">
                <option value="">— انتخاب نقش —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Msg v={userMsg} />
            <button onClick={createUser} disabled={userBusy} className="btn btn-primary btn-sm">{userBusy ? '…' : 'ساخت کاربر'}</button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
