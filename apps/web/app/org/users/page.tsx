'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { OrgNav } from '../nav';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

interface Role { id: string; name: string; permissions: string[]; isSystem: boolean }
interface User { id: string; username: string; displayName: string; isActive: boolean; role: { name: string } | null }

export default function UsersRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState('');

  // new role
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  // new user
  const [nu, setNu] = useState({ username: '', displayName: '', password: '', roleId: '' });

  const load = async () => {
    try {
      const [r, u, c] = await Promise.all([
        client.get<Role[]>('/roles', 'org'),
        client.get<User[]>('/users', 'org'),
        client.get<{ key: string }[]>('/roles/catalog', 'org'),
      ]);
      setRoles(r);
      setUsers(u);
      setCatalog(c.map((x) => x.key));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const createRole = async () => {
    setError('');
    try {
      await client.post('/roles', { name: roleName, permissions: [...rolePerms] }, 'org');
      setRoleName(''); setRolePerms(new Set()); load();
    } catch (e: any) { setError(e.message); }
  };

  const createUser = async () => {
    setError('');
    try {
      await client.post('/users', nu, 'org');
      setNu({ username: '', displayName: '', password: '', roleId: '' }); load();
    } catch (e: any) { setError(e.message); }
  };

  const toggle = (p: string) => {
    const s = new Set(rolePerms);
    s.has(p) ? s.delete(p) : s.add(p);
    setRolePerms(s);
  };

  return (
    <div className="space-y-5">
      <OrgNav />
      {error && <div className="rounded-lg border p-2 text-sm" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}

      <section>
        <h2 className="font-bold mb-2">نقش‌ها</h2>
        <div className="rounded-xl border p-3 mb-3 space-y-2" style={card}>
          {roles.map((r) => (
            <div key={r.id} className="flex justify-between text-sm border-b pb-1" style={{ borderColor: 'var(--border)' }}>
              <span>{r.name}{r.isSystem ? ' (سیستمی)' : ''}</span>
              <span style={{ color: 'var(--muted)' }}>{r.permissions.length} مجوز</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border p-3 space-y-2" style={card}>
          <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="نام نقش جدید" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
          <div className="flex flex-wrap gap-2">
            {catalog.map((p) => (
              <label key={p} className="text-xs flex items-center gap-1 border rounded px-2 py-1" style={{ borderColor: 'var(--border)' }}>
                <input type="checkbox" checked={rolePerms.has(p)} onChange={() => toggle(p)} />
                {p}
              </label>
            ))}
          </div>
          <button onClick={createRole} disabled={!roleName || rolePerms.size === 0} className="rounded-lg bg-brand text-white px-3 py-1 text-sm disabled:opacity-50">ساخت نقش</button>
        </div>
      </section>

      <section>
        <h2 className="font-bold mb-2">کاربران</h2>
        <div className="rounded-xl border p-3 mb-3 space-y-2" style={card}>
          {users.map((u) => (
            <div key={u.id} className="flex justify-between text-sm border-b pb-1" style={{ borderColor: 'var(--border)' }}>
              <span>{u.displayName} ({u.username})</span>
              <span style={{ color: 'var(--muted)' }}>{u.role?.name}{u.isActive ? '' : ' — غیرفعال'}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl border p-3 space-y-2" style={card}>
          <input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} placeholder="نام کاربری" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
          <input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} placeholder="نام نمایشی" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
          <input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} placeholder="رمز عبور (حداقل ۸ نویسه)" className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }} />
          <select value={nu.roleId} onChange={(e) => setNu({ ...nu, roleId: e.target.value })} className="w-full rounded-lg border p-2 bg-transparent text-sm" style={{ borderColor: 'var(--border)' }}>
            <option value="" style={{ color: '#000' }}>انتخاب نقش</option>
            {roles.map((r) => <option key={r.id} value={r.id} style={{ color: '#000' }}>{r.name}</option>)}
          </select>
          <button onClick={createUser} disabled={!nu.username || !nu.password || !nu.roleId} className="rounded-lg bg-brand text-white px-3 py-1 text-sm disabled:opacity-50">ساخت کاربر</button>
        </div>
      </section>
    </div>
  );
}
