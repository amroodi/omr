'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, FancyLoader } from '../../components/ui';
import { UploadButton } from '../../components/upload';
import { ORG_NAV } from '../nav';
import { Flash } from '../../components/Toaster';

interface Row {
  id: string; number: number; claimType: string; claimTypeLabel: string; fullName: string | null; nationalCode: string | null; companyName: string | null;
  policyNumber: string | null; eventDate: string | null; payableAmount: string | null; caseStage: string | null; imported: boolean; createdAt: string; sharedCompanyId: string | null; sharedCompanyName: string | null;
}
interface Options { caseTypes: { code: string; label: string }[]; companies: { id: string; name: string }[] }
interface Preview { summary: { total: number; valid: number; invalid: number }; rows: { row: number; fullName: string; nationalCode: string; errors: string[] }[] }

const fa = (n: number) => n.toLocaleString('fa-IR');

/**
 * «میز کار مستقل»: the brokerage's own cases, outside the hierarchy. The operator picks a نوع پرونده and
 * fills the case like «ویرایش», or imports an Excel register, and may share cases with a بیمه‌گزار.
 */
export default function SpareDesk() {
  const router = useRouter();
  const [opts, setOpts] = useState<Options | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [f, setF] = useState({ nationalCode: '', name: '', claimType: '', companyId: '' });
  const [newType, setNewType] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [shareTo, setShareTo] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [imp, setImp] = useState<{ file: File; preview: Preview } | null>(null);
  const [canExport, setCanExport] = useState(false);
  useEffect(() => { setCanExport(hasPerm('org', 'export:list')); }, []);

  const load = (q = f) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return client.get<Row[]>(`/spare?${p}`, 'org').then((r) => { setRows(r); setPicked(new Set()); }).catch((e) => setError(e.message));
  };
  useEffect(() => {
    client.get<Options>('/spare/options', 'org').then((o) => { setOpts(o); setNewType(o.caseTypes[0]?.code ?? ''); load(); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const create = () => act(async () => { const c = await client.post<{ id: string }>('/spare', { claimType: newType }, 'org'); router.push(`/org/spare/${c.id}`); });
  const share = (companyId: string | null) => act(async () => {
    const r = await client.post<{ updated: number }>('/spare/share', { ids: [...picked], companyId }, 'org');
    setMsg(companyId ? `${fa(r.updated)} پرونده با بیمه‌گزار به اشتراک گذاشته شد` : `اشتراک ${fa(r.updated)} پرونده لغو شد`);
    await load();
  });
  const commitImport = () => act(async () => {
    const fd = new FormData(); fd.append('file', imp!.file);
    const r = await client.upload<{ created: number; duplicates: number; invalid: number }>(`/spare/import/commit?claimType=${encodeURIComponent(newType)}`, fd, 'org', () => {});
    setImp(null);
    setMsg(`${fa(r.created)} پرونده ثبت شد؛ ${fa(r.duplicates)} تکراری و ${fa(r.invalid)} نامعتبر کنار گذاشته شد.`);
    await load();
  });
  const exportExcel = () => act(async () => {
    const list = (rows ?? []).filter((r) => !picked.size || picked.has(r.id));
    await client.downloadPost('/exports/table.xlsx', {
      title: 'میز کار مستقل',
      headers: ['شماره', 'نوع پرونده', 'نام و نام خانوادگی', 'کد ملی', 'شرکت', 'شماره بیمه‌نامه', 'تاریخ وقوع', 'مبلغ قابل پرداخت', 'وضعیت پرونده', 'اشتراک با'],
      rows: list.map((r) => [String(r.number), r.claimTypeLabel, r.fullName ?? '', r.nationalCode ?? '', r.companyName ?? '', r.policyNumber ?? '', r.eventDate ?? '', r.payableAmount ?? '', r.caseStage ?? '', r.sharedCompanyName ?? '']),
    }, 'org', 'spare-desk.xlsx');
  });
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const all = !!rows?.length && rows.every((r) => picked.has(r.id));

  return (
    <Shell title="میز کار مستقل" breadcrumb="میز کار مستقل" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      <Flash id={msg} text={msg} ok />
      {!opts ? (error ? null : <div className="pcard p-10 flex justify-center"><FancyLoader label="در حال دریافت" /></div>) : (
        <>
          <div className="pcard p-5 pform sn-search">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <b className="text-sm">پروندهٔ جدید:</b>
              <select className="input" style={{ width: 300 }} value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="نوع پرونده">
                {opts.caseTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <button className="btn btn-solid btn-sm" disabled={busy || !newType} onClick={create}>ثبت پرونده</button>
              <UploadButton accept=".xlsx,.csv" maxMB={5} title="ورود پرونده‌ها از اکسل" camera={false}
                onUpload={async (file, onP) => { const fd = new FormData(); fd.append('file', file); const preview = await client.upload<Preview>('/spare/import/preview', fd, 'org', onP); setImp({ file, preview }); }}>
                ورود از اکسل
              </UploadButton>
            </div>
            {imp && (
              <div className="pinfobox mb-2">
                <b>{imp.file.name}</b>: {fa(imp.preview.summary.valid)} ردیف معتبر، {fa(imp.preview.summary.invalid)} ردیف نامعتبر. همهٔ ردیف‌های معتبر با نوع پروندهٔ انتخاب‌شده ثبت می‌شوند.
                {imp.preview.rows.filter((r) => r.errors.length).slice(0, 5).map((r) => <div key={r.row} className="text-xs">ردیف {fa(r.row)}: {r.errors.join('، ')}</div>)}
                <div className="flex justify-center gap-2 mt-1">
                  <button className="btn btn-solid btn-sm" disabled={busy || !imp.preview.summary.valid} onClick={commitImport}>ثبت پرونده‌ها</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setImp(null)}>انصراف</button>
                </div>
              </div>
            )}
            <div className="sn-fields">
              <input className="input" placeholder="کد ملی" inputMode="numeric" value={f.nationalCode} onChange={upd('nationalCode')} />
              <input className="input" placeholder="نام بیمه‌شده" value={f.name} onChange={upd('name')} onKeyDown={(e) => e.key === 'Enter' && load()} />
              <select className="input" value={f.claimType} onChange={upd('claimType')} aria-label="نوع پرونده در جستجو">
                <option value="">— نوع پرونده —</option>
                {opts.caseTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <select className="input" value={f.companyId} onChange={upd('companyId')} aria-label="اشتراک با بیمه‌گزار">
                <option value="">— اشتراک با بیمه‌گزار —</option>
                {opts.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="flex gap-2">
                <button className="btn btn-solid btn-sm px-6" onClick={() => load()}>جستجو</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { const e = { nationalCode: '', name: '', claimType: '', companyId: '' }; setF(e); load(e); }}>پاک کردن</button>
              </span>
            </div>
          </div>

          <div className="sn-panel" style={{ borderTop: '1px solid var(--border)', borderRadius: 6 }}>
            <div className="sn-bar">
              <h3 className="font-bold">پرونده‌ها {rows ? `(${fa(rows.length)})` : ''}</h3>
              <span className="flex items-center gap-2 flex-wrap">
                {picked.size > 0 && <>
                  <span>{fa(picked.size)} انتخاب‌شده</span>
                  <select className="input" style={{ width: 220 }} value={shareTo} onChange={(e) => setShareTo(e.target.value)} aria-label="بیمه‌گزار مقصد">
                    <option value="">بیمه‌گزار…</option>
                    {opts.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn btn-primary btn-sm" disabled={busy || !shareTo} onClick={() => share(shareTo)}>اشتراک</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => share(null)}>لغو اشتراک</button>
                </>}
                {canExport && <button className="wd-xls" disabled={!rows?.length || busy} onClick={exportExcel}>اکسل</button>}
              </span>
            </div>
            {!rows ? <div className="p-8 flex justify-center"><FancyLoader label="در حال دریافت" /></div>
              : rows.length === 0 ? <div className="p-6 text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد.</div> : (
                <div className="overflow-x-auto">
                  <table className="table sn-table">
                    <thead><tr>
                      <th style={{ width: 28 }}><input type="checkbox" aria-label="انتخاب همه" checked={all} onChange={(e) => setPicked(new Set(e.target.checked ? rows.map((r) => r.id) : []))} /></th>
                      {['#', 'عملیات', 'نام و نام خانوادگی', 'کد ملی', 'نوع پرونده', 'شرکت', 'شماره بیمه‌نامه', 'تاریخ وقوع', 'وضعیت پرونده', 'تاریخ ثبت', 'اشتراک با'].map((h) => <th key={h}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className={picked.has(r.id) ? 'is-picked' : undefined}>
                          <td><input type="checkbox" aria-label={`انتخاب پرونده ${fa(r.number)}`} checked={picked.has(r.id)} onChange={() => setPicked((c) => { const n = new Set(c); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                          <td>{fa(r.number)}</td>
                          <td><Link href={`/org/spare/${r.id}`} className="sn-act">تکمیل پرونده</Link></td>
                          <td>{r.fullName || '—'}</td>
                          <td className="ltr-num">{r.nationalCode || '—'}</td>
                          <td>{r.claimTypeLabel}</td>
                          <td>{r.companyName || '—'}</td>
                          <td className="ltr-num">{r.policyNumber || '—'}</td>
                          <td className="ltr-num">{r.eventDate || '—'}</td>
                          <td>{r.caseStage || '—'}</td>
                          <td className="ltr-num">{r.createdAt}</td>
                          <td>{r.sharedCompanyName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      )}
    </Shell>
  );
}
