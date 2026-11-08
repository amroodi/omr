'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ORG_NAV } from '../nav';
import { ErrorBox, FancyLoader, Overlay } from '../../components/ui';

// «تخصیص پرونده‌ها» («روند سیناد», insurer admin): who holds which شعبه case, each evaluator's load,
// bulk hand-out / take-back, and per-evaluator settings (paused, batch size, case types).

interface Evaluator {
  id: string; name: string; username: string; role: string; branchId: string | null; branchName: string | null; active: boolean; lastLoginAt: string | null;
  batchSize: number | null; paused: boolean; claimTypes: string[]; load: { evaluate: number; later: number; doctor: number };
}
interface Case {
  id: string; claimNumber: string; policyNumber: string | null; name: string | null; nationalCode: string | null; claimType: string; claimTypeLabel: string;
  amount: string | null; branchId: string | null; branchName: string | null; evaluatorId: string | null; evaluatorName: string | null; evaluatorAt: string | null;
  state: 'pool' | 'evaluate' | 'later' | 'doctor'; since: string;
}
interface Allocation { batchSize: number; caseTypes: { code: string; label: string }[]; branches: { id: string; name: string }[]; evaluators: Evaluator[]; cases: Case[] }

const fa = (n: number) => n.toLocaleString('fa-IR');
const money = (s: string | null) => (s ? Number(s).toLocaleString('fa-IR') : '—');
const STATE_FA: Record<Case['state'], string> = { pool: 'تخصیص‌نیافته', evaluate: 'در انتظار ارزیابی اولیه', later: 'بعدا بررسی میکنم', doctor: 'نزد پزشک معتمد' };

export default function AllocationPage() {
  const [data, setData] = useState<Allocation | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState('');
  const [state, setState] = useState('');
  const [who, setWho] = useState('');
  const [type, setType] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [edit, setEdit] = useState<Evaluator | null>(null);

  const load = () => client.get<Allocation>('/claims/sinad/allocation', 'org').then((d) => { setData(d); setPicked(new Set()); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const cases = useMemo(() => (data?.cases ?? []).filter((c) =>
    (!branch || (branch === 'none' ? !c.branchId : c.branchId === branch)) && (!state || c.state === state) && (!who || c.evaluatorId === who) && (!type || c.claimType === type)), [data, branch, state, who, type]);
  const pickedCases = (data?.cases ?? []).filter((c) => picked.has(c.id));
  // Evaluators a selection can go to: the selected cases' branch (a case with no branch yet goes to anyone's).
  const pickedBranches = new Set(pickedCases.map((c) => c.branchId).filter(Boolean));
  const targets = (data?.evaluators ?? []).filter((u) => u.active && (pickedBranches.size === 0 || (pickedBranches.size === 1 && pickedBranches.has(u.branchId))));
  const shownEvaluators = (data?.evaluators ?? []).filter((u) => !branch || u.branchId === branch);
  const pool = (data?.cases ?? []).filter((c) => c.state === 'pool' && (!branch || c.branchId === branch || !c.branchId)).length;

  const assign = async (userId: string | null) => {
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await client.post<{ done: number; otherBranch: number; notAtBranch: number }>('/claims/sinad/assign', { claimIds: [...picked], userId }, 'org');
      const parts = [userId ? `${fa(r.done)} پرونده تخصیص داده شد.` : `${fa(r.done)} پرونده به پرونده‌های تخصیص‌نیافته برگشت.`];
      if (r.otherBranch) parts.push(`${fa(r.otherBranch)} پرونده متعلق به شعبهٔ دیگری است و تخصیص نیافت.`);
      if (r.notAtBranch) parts.push(`${fa(r.notAtBranch)} پرونده دیگر در شعبه نیست.`);
      setMsg(parts.join(' ')); setTarget('');
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const toggleAll = (on: boolean) => setPicked((cur) => { const n = new Set(cur); cases.forEach((c) => (on ? n.add(c.id) : n.delete(c.id))); return n; });

  return (
    <Shell title="تخصیص پرونده‌ها" sectionLabel="میز کار" nav={ORG_NAV} realm="org"
      action={<Link href="/org/work-desk" className="btn btn-ghost btn-sm">بازگشت به میز کار</Link>}>
      <ErrorBox message={error} />
      {msg && <div className="pinfobox mb-3 text-sm">{msg}</div>}
      {!data ? (
        !error && <div className="p-12 flex justify-center"><FancyLoader label="در حال دریافت…" /></div>
      ) : (
        <>
          {/* ── Evaluators ── */}
          <div className="sn-bar mt-1"><h3 className="font-bold">ارزیابان شعبه <span style={{ color: 'var(--muted)' }}>({fa(shownEvaluators.length)})</span></h3>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>اندازهٔ پیش‌فرض هر دسته: {fa(data.batchSize)} پرونده (Model View) · تخصیص‌نیافته: {fa(pool)}</span></div>
          <div className="sn-panel mb-4 overflow-x-auto">
            {shownEvaluators.length === 0 ? <div className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>ارزیابی در این شعبه نیست.</div> : (
              <table className="table sn-table">
                <thead><tr>{['#', 'ارزیاب', 'شعبه', 'نقش', 'وضعیت', 'در انتظار ارزیابی اولیه', 'بعدا بررسی میکنم', 'نزد پزشک معتمد', 'اندازهٔ دسته', 'نوع پرونده', 'آخرین ورود', 'عملیات'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {shownEvaluators.map((u, i) => (
                    <tr key={u.id} className={who === u.id ? 'is-alloc' : ''}>
                      <td>{fa(i + 1)}</td>
                      <td className="font-semibold">{u.name} <span className="text-xs" style={{ color: 'var(--muted)' }}>({u.username})</span></td>
                      <td>{u.branchName ?? '—'}</td>
                      <td>{u.role}</td>
                      <td>{!u.active ? <span className="badge badge-neutral">غیرفعال</span> : u.paused ? <span className="badge badge-warning">متوقف</span> : <span className="badge badge-success">فعال</span>}</td>
                      <td>{fa(u.load.evaluate)}</td>
                      <td>{fa(u.load.later)}</td>
                      <td>{fa(u.load.doctor)}</td>
                      <td>{u.batchSize ? fa(u.batchSize) : <span style={{ color: 'var(--muted)' }}>پیش‌فرض</span>}</td>
                      <td className="text-xs">{u.claimTypes.length ? u.claimTypes.map((c) => data.caseTypes.find((t) => t.code === c)?.label ?? c).join('، ') : <span style={{ color: 'var(--muted)' }}>همه</span>}</td>
                      <td className="text-xs">{u.lastLoginAt ?? '—'}</td>
                      <td><span className="flex items-center gap-1">
                        <button className="sn-act" onClick={() => setEdit(u)}>تنظیمات</button>
                        <button className="sn-act is-ghost" onClick={() => { setWho(who === u.id ? '' : u.id); setState(''); }}>{who === u.id ? 'همهٔ پرونده‌ها' : 'پرونده‌های او'}</button>
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Cases at شعبه ── */}
          <div className="pcard p-3 pform mb-0 flex flex-wrap items-center gap-2" style={{ borderRadius: '6px 6px 0 0' }}>
            <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => { setBranch(e.target.value); setPicked(new Set()); }}>
              <option value="">همهٔ شعب</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="none">بدون شعبه</option>
            </select>
            <select className="input" style={{ width: 'auto' }} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">همهٔ وضعیت‌ها</option>
              {Object.entries(STATE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">همهٔ ارزیابان</option>
              {data.evaluators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">همهٔ انواع پرونده</option>
              {data.caseTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => { setBranch(''); setState(''); setWho(''); setType(''); }}>پاک کردن</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setMsg(''); load(); }}>بروزرسانی</button>
          </div>
          <div className="sn-panel">
            <div className="sn-bar">
              <h3 className="font-bold">پرونده‌های شعبه <span style={{ color: 'var(--muted)' }}>({fa(cases.length)})</span></h3>
              <span className="flex items-center gap-2 flex-wrap">
                {picked.size > 0 && <>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{fa(picked.size)} انتخاب‌شده</span>
                  <select className="input" style={{ width: 'auto', height: 28, fontSize: 12 }} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">{targets.length ? 'تخصیص به ارزیاب…' : 'پرونده‌های یک شعبه را انتخاب کنید'}</option>
                    {targets.map((u) => <option key={u.id} value={u.id}>{u.name}{u.paused ? ' (متوقف)' : ''} — {fa(u.load.evaluate)} در کارتابل</option>)}
                  </select>
                  <button className="sn-act is-green" disabled={busy || !target} onClick={() => assign(target)}>تخصیص</button>
                  <button className="sn-act is-ghost" disabled={busy || !pickedCases.some((c) => c.evaluatorId)} onClick={() => assign(null)} title="پرونده‌ها از کارتابل ارزیاب خارج و به پرونده‌های تخصیص‌نیافته برمی‌گردند">خارج کردن از کارتابل</button>
                </>}
              </span>
            </div>
            {cases.length === 0 ? <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد.</div> : (
              <div className="overflow-x-auto">
                <table className="table sn-table">
                  <thead><tr>
                    <th style={{ width: 28 }}><input type="checkbox" aria-label="انتخاب همه" checked={cases.every((c) => picked.has(c.id))} onChange={(e) => toggleAll(e.target.checked)} /></th>
                    {['#', 'نام و نام خانوادگی', 'کد ملی', 'شماره بیمه‌نامه', 'نوع پرونده', 'مبلغ (ریال)', 'شعبه', 'وضعیت', 'ارزیاب', 'تاریخ تخصیص', 'آخرین تغییر', ''].map((h, i) => <th key={i}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {cases.map((c, i) => (
                      <tr key={c.id} className={c.evaluatorId ? 'is-alloc' : ''}>
                        <td><input type="checkbox" aria-label="انتخاب" checked={picked.has(c.id)} onChange={(e) => setPicked((cur) => { const n = new Set(cur); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                        <td>{fa(i + 1)}</td>
                        <td className="font-semibold">{c.name ?? '—'}</td>
                        <td style={{ direction: 'ltr', textAlign: 'right' }}>{c.nationalCode ?? '—'}</td>
                        <td style={{ direction: 'ltr', textAlign: 'right' }}>{c.policyNumber ?? c.claimNumber}</td>
                        <td>{c.claimTypeLabel}</td>
                        <td>{money(c.amount)}</td>
                        <td>{c.branchName ?? '—'}</td>
                        <td>{STATE_FA[c.state]}</td>
                        <td>{c.evaluatorName ?? '—'}</td>
                        <td className="text-xs">{c.evaluatorAt ?? '—'}</td>
                        <td className="text-xs">{c.since}</td>
                        <td><a href={`/org/claims/${c.id}`} target="_blank" rel="noopener" className="sn-act is-ghost">مشاهده</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {edit && data && <SettingsModal u={edit} data={data} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setMsg(m); load(); }} />}
    </Shell>
  );
}

function SettingsModal({ u, data, onClose, onSaved }: { u: Evaluator; data: Allocation; onClose: () => void; onSaved: (msg: string) => void }) {
  const [paused, setPaused] = useState(u.paused);
  const [batch, setBatch] = useState(u.batchSize ? String(u.batchSize) : '');
  const [types, setTypes] = useState<string[]>(u.claimTypes);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const n = batch.trim() ? parseInt(batch.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), 10) : null;
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 100)) { setErr('اندازهٔ دسته باید بین ۱ تا ۱۰۰ باشد.'); return; }
    setBusy(true); setErr('');
    try { await client.put(`/claims/sinad/evaluators/${u.id}`, { paused, batchSize: n, claimTypes: types }, 'org'); onSaved(`تنظیمات ${u.name} ذخیره شد.`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Overlay onClose={onClose}>
      <div className="pmodal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="pmodal-head">
          <span className="pmodal-title">تنظیمات تخصیص — {u.name}</span>
          <button className="pmodal-x" onClick={onClose} aria-label="بستن">×</button>
        </div>
        <div className="pmodal-body space-y-4 text-sm">
          <ErrorBox message={err} />
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="mt-1" />
            <span><b>توقف تخصیص</b><br /><span className="text-xs" style={{ color: 'var(--muted)' }}>پروندهٔ جدیدی به این ارزیاب داده نمی‌شود (مثلاً هنگام مرخصی). پرونده‌های فعلی او در کارتابلش می‌ماند.</span></span>
          </label>
          <div>
            <div className="font-bold mb-1">اندازهٔ هر دسته</div>
            <input className="input" style={{ width: 120 }} inputMode="numeric" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder={`پیش‌فرض: ${fa(data.batchSize)}`} />
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>خالی بماند تا اندازهٔ پیش‌فرض Model View به کار رود.</div>
          </div>
          <div>
            <div className="font-bold mb-1">نوع پرونده‌هایی که به او داده می‌شود</div>
            <div className="grid grid-cols-2 gap-1">
              {data.caseTypes.map((t) => (
                <label key={t.code} className="flex items-center gap-2">
                  <input type="checkbox" checked={types.includes(t.code)} onChange={(e) => setTypes((cur) => (e.target.checked ? [...cur, t.code] : cur.filter((x) => x !== t.code)))} />
                  {t.label}
                </label>
              ))}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>هیچ‌کدام انتخاب نشود یعنی همهٔ انواع. مدیر همچنان می‌تواند هر پرونده‌ای را دستی به او تخصیص دهد.</div>
          </div>
        </div>
        <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
          <button disabled={busy} onClick={save} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand)' }}>ذخیره</button>
        </div>
      </div>
    </Overlay>
  );
}
