'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { ErrorBox, Spinner } from '../../components/ui';
import { AgentsPanel } from '../../components/operators/AgentsPanel';
import { RepresentativesPanel } from '../../components/operators/RepresentativesPanel';
import { StaffPanel, StaffBranch, StaffRole } from '../../components/operators/StaffPanel';

interface Org { id: string; name: string; slug: string; kind: 'BROKER' | 'INSURER'; isActive: boolean }
interface Options { kind: 'BROKER' | 'INSURER'; name: string; roles: StaffRole[]; branches: StaffBranch[] }
type Tab = 'companies' | 'reps' | 'agents' | 'staff';

const chip = (on: boolean) => (on ? { background: 'var(--brand)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' });
const TABS: Record<'BROKER' | 'INSURER', [Tab, string][]> = {
  BROKER: [['companies', 'بیمه‌گزاران'], ['reps', 'نمایندگان'], ['staff', 'کارکنان سازمان']],
  INSURER: [['agents', 'نمایندگان بیمه'], ['staff', 'کارکنان سازمان']],
};

/**
 * Super Admin › «کاربران پنل‌ها»: every organization's panel-1 users, managed exactly as that
 * organization's own admin does in its panel 2 — a brokerage's بیمه‌گزاران (company logins), their
 * نمایندگان and its staff; an insurer's نمایندگان بیمه and its staff. Each change runs through the
 * organization's own rules and is audited with Super Admin as the actor.
 */
export default function AdminOperators() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState('');
  const [opts, setOpts] = useState<Options | null>(null);
  const [tab, setTab] = useState<Tab>('staff');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    client.get<Org[]>('/admin/operators', 'super').then((l) => {
      setOrgs(l);
      const want = new URLSearchParams(window.location.search).get('org');
      setOrgId((l.find((o) => o.id === want) ?? l.find((o) => o.slug === 'damuon') ?? l[0])?.id ?? '');
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOpts = () => client.get<Options>(`/admin/operators/${orgId}/options`, 'super').then((o) => {
    setOpts(o);
    setTab((t) => (TABS[o.kind].some(([k]) => k === t) ? t : TABS[o.kind][0][0]));
  }).catch((e) => setError(e.message));
  useEffect(() => { if (!orgId) return; setOpts(null); setError(''); loadOpts(); /* eslint-disable-next-line */ }, [orgId]);

  const base = `/admin/operators/${orgId}`;
  const org = orgs?.find((o) => o.id === orgId);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">کاربران پنل‌ها</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>کاربران پنل ۱ و کارکنان هر سازمان — همان کاری که مدیر خود سازمان در پنل ۲ انجام می‌دهد</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/policyholders" className="btn btn-ghost btn-sm">بیمه‌گزاران و بیمه‌نامه‌ها</Link>
          <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت</Link>
        </div>
      </div>
      <ErrorBox message={error} />

      <div className="card p-4 flex items-end gap-3 flex-wrap">
        <label className="text-sm">سازمان
          <select className="input mt-1" style={{ minWidth: 260 }} value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={!orgs}>
            {orgs?.map((o) => <option key={o.id} value={o.id}>{o.kind === 'BROKER' ? 'کارگزاری' : 'بیمه‌گر'} — {o.name}{o.isActive ? '' : ' (غیرفعال)'}</option>)}
          </select>
        </label>
        {opts && (
          <div className="flex gap-2 flex-wrap">
            {TABS[opts.kind].map(([k, label]) => <button key={k} className="btn btn-sm" style={chip(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
          </div>
        )}
      </div>

      {opts && (
        <div className="pinfobox text-xs">
          {opts.kind === 'BROKER'
            ? <>پنل ۱ «{opts.name}»: <b>بیمه‌گزار</b> با کد بیمه‌گزار و <b>نماینده</b> با کد ملی از «ورود برای بارگذاری مدارک › بیمه‌گزار / نماینده» وارد می‌شوند؛ <b>کارکنان سازمان</b> با نام کاربری خود از همان صفحه، زبانهٔ «کارکنان سازمان» (اگر نقششان ثبت پرونده دارد).</>
            : <>پنل ۱ «{opts.name}»: <b>نماینده بیمه</b> با کد ملی از «ورود برای بارگذاری مدارک › نماینده بیمه» وارد می‌شود و پرونده‌اش به شعبهٔ او می‌رود؛ <b>کارکنان سازمان</b> با نام کاربری خود از زبانهٔ «کارکنان سازمان» (اگر نقششان ثبت پرونده دارد).</>}
        </div>
      )}

      {!opts ? (orgId ? <div className="card p-10 flex justify-center"><Spinner /></div> : null) : (
        <div key={orgId}>
          {tab === 'companies' && (
            <div className="card p-4 space-y-2">
              <h3 className="font-bold">شرکت‌های بیمه‌گزار «{org?.name}»</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                ورود هر بیمه‌گزار (کد بیمه‌گزار و رمز عبور)، بیمه‌نامه‌های سالانه، ورود اکسل بیمه‌گر و حذف گروهی در صفحهٔ «بیمه‌گزاران» مدیر سامانه است.
                مدیر همین کارگزاری هم در پنل ۲ › «بیمه‌گزاران» شرکت‌های خود را می‌سازد، ویرایش و حذف می‌کند.
              </p>
              <Link href={`/admin/policyholders?broker=${orgId}`} className="btn btn-primary btn-sm">مدیریت بیمه‌گزاران این کارگزاری</Link>
            </div>
          )}
          {tab === 'reps' && <RepresentativesPanel realm="super" base={base} />}
          {tab === 'agents' && <AgentsPanel realm="super" base={base} />}
          {tab === 'staff' && <StaffPanel realm="super" base={base} roles={opts.roles} branches={opts.branches} isInsurer={opts.kind === 'INSURER'} onChanged={loadOpts} />}
        </div>
      )}
    </div>
  );
}
