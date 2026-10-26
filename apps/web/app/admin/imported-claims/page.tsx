'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { ErrorBox, Spinner, STATUS_MAP } from '../../components/ui';

interface Row {
  id: string; claimNumber: string; policyNumber: string | null; status: string; legacyStatus: string | null; deceasedName: string | null;
  employerName: string | null; insurerName: string; brokerName: string; eventDate: string | null; createdAt: string; deleted: boolean;
}
const faN = (n: number) => n.toLocaleString('fa-IR');
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/**
 * «پرونده‌های ورود دسته‌ای» (Super Admin): cases brought in from Excel by «ورود دسته‌ای», with permanent
 * single, selected and bulk delete (the bulk one deletes every case matching the current filter).
 */
export default function ImportedClaims() {
  const router = useRouter();
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    client.get<{ id: string; name: string }[]>('/tenants', 'super').then(setTenants).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = () => {
    const p = new URLSearchParams(); if (tenantId) p.set('tenantId', tenantId); if (q.trim()) p.set('q', q.trim());
    setRows(null);
    client.get<Row[]>(`/admin/imported-claims?${p}`, 'super').then((r) => { setRows(r); setPicked(new Set()); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const del = async (what: 'one' | 'picked' | 'all', r?: Row) => {
    const n = what === 'one' ? 1 : what === 'picked' ? picked.size : rows?.length ?? 0;
    if (!n) return;
    const label = what === 'one' ? `پروندهٔ ${r!.claimNumber}` : what === 'picked' ? `${faN(n)} پروندهٔ انتخاب‌شده` : `همهٔ ${faN(n)} پروندهٔ این فهرست`;
    if (!window.confirm(`${label} با همهٔ مدارک و سوابقش برای همیشه حذف شود؟ این کار قابل بازگشت نیست.`)) return;
    if (what === 'all' && toAscii(window.prompt(`برای تأیید، تعداد (${n}) را وارد کنید:`) ?? '').trim() !== String(n)) return;
    setBusy(true); setMsg(''); setError('');
    try {
      const res = what === 'one' ? await client.del<{ deleted: number }>(`/admin/imported-claims/${r!.id}`, 'super')
        : await client.post<{ deleted: number }>('/admin/imported-claims/delete', what === 'picked' ? { ids: [...picked] } : { all: true, tenantId: tenantId || undefined, q: q.trim() || undefined }, 'super');
      setMsg(`${faN(res.deleted)} پرونده برای همیشه حذف شد.`);
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">پرونده‌های ورود دسته‌ای</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>پرونده‌هایی که از فایل اکسل با «ورود دسته‌ای» وارد شده‌اند — حذف تکی، گروهی یا همه</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>

      <div className="card p-4 flex gap-2 flex-wrap items-center">
        <select className="input" style={{ maxWidth: 280 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">— همهٔ سازمان‌ها —</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 300 }} placeholder="شماره پرونده، شماره بیمه‌نامه یا نام شرکت" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn btn-ghost btn-sm" onClick={load}>جستجو</button>
        {rows && <span className="text-sm mr-auto" style={{ color: 'var(--muted)' }}>{faN(rows.length)} پرونده</span>}
        {picked.size > 0 && <button className="btn btn-sm" style={{ background: 'var(--danger)', color: '#fff' }} disabled={busy} onClick={() => del('picked')}>حذف انتخاب‌شده‌ها ({faN(picked.size)})</button>}
        {rows && rows.length > 0 && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => del('all')}>{q.trim() || tenantId ? `حذف همهٔ نتایج (${faN(rows.length)})` : `حذف همه (${faN(rows.length)})`}</button>}
      </div>
      <ErrorBox message={error} />
      {msg && <div className="alert-success">{msg}</div>}

      <div className="card overflow-x-auto">
        {!rows ? <div className="p-10 flex justify-center"><Spinner /></div> : (
          <table className="table">
            <thead><tr>
              <th style={{ width: 40 }}><input type="checkbox" aria-label="انتخاب همه" checked={rows.length > 0 && rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              {['شماره پرونده', 'شماره بیمه‌نامه', 'بیمه‌شده (متوفی)', 'شرکت', 'بیمه‌گر', 'کارگزاری', 'تاریخ فوت', 'وضعیت', 'ورود', ''].map((h) => <th key={h}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={11} className="text-center py-8" style={{ color: 'var(--muted)' }}>پرونده‌ای از ورود دسته‌ای نیست</td></tr> : rows.map((r) => (
                <tr key={r.id} className={picked.has(r.id) ? 'is-picked' : undefined}>
                  <td><input type="checkbox" aria-label={`انتخاب ${r.claimNumber}`} checked={picked.has(r.id)} onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                  <td className="latin-digits" style={{ whiteSpace: 'nowrap' }}>{r.claimNumber}</td>
                  <td className="latin-digits">{r.policyNumber ?? '—'}</td>
                  <td>{r.deceasedName ?? '—'}</td>
                  <td>{r.employerName ?? '—'}</td>
                  <td>{r.insurerName}</td>
                  <td>{r.brokerName}</td>
                  <td>{r.eventDate ?? '—'}</td>
                  <td>{r.legacyStatus || STATUS_MAP[r.status]?.label || r.status}{r.deleted ? ' (در سطل بازیافت)' : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.createdAt}</td>
                  <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => del('one', r)}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
