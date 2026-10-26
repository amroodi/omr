'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toGregorian } from 'jalaali-js';
import { client, getToken } from '../../../lib/client';
import { ErrorBox, Spinner } from '../../components/ui';
import { JalaliDatePicker } from '../../components/JalaliDatePicker';
import { UploadButton } from '../../components/upload';

type Line = 'LIFE' | 'ACCIDENT';
interface Contract { id: string; line: Line | null; lineLabel: string | null; policyNumber: string | null; insurerTenantId: string; insurerName: string; startDate: string | null; endDate: string | null; isActive: boolean; inForce: boolean }
interface Company { id: string; name: string; code: string | null; isActive: boolean; brokerTenantId: string; brokerName: string; hasPassword: boolean; passwordSetAt: string | null; lines: Line[]; contracts: Contract[] }
interface Opt { id: string; name: string; slug: string }
interface Cred { code: string; name: string; password: string }
interface ImportResult {
  sheets: { name: string; line: Line; rows: number }[]; companiesCreated: number; companiesUpdated: number;
  contractsCreated: number; contractsUpdated: number; contractsSkipped: number; errors: { sheet: string; row: number; message: string }[]; credentials: Cred[];
}

const LINE_FA: Record<Line, string> = { LIFE: 'عمر', ACCIDENT: 'حوادث' };
const faN = (n: number) => n.toLocaleString('fa-IR');
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const jToIso = (v: string) => {
  const p = toAscii(v).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => !n)) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  return new Date(gy, gm - 1, gd).toISOString();
};

/** Save logins as a CSV that Excel opens with Persian intact (UTF-8 BOM). */
function downloadCreds(rows: Cred[], name = 'policyholder-logins.csv') {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = '﻿' + ['کد بیمه‌گزار,نام بیمه‌گزار,رمز عبور', ...rows.map((r) => [r.code, r.name, r.password].map(esc).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

/**
 * «بیمه‌گزاران» (Super Admin): every brokerage's بیمه‌گزار companies with their login (کد بیمه‌گزار +
 * password) and بیمه‌نامه‌ها per line and year. The insurer's yearly Excel export is imported here;
 * new policy numbers for the next year can also be added by hand.
 */
export default function AdminPolicyholders() {
  const router = useRouter();
  const [opts, setOpts] = useState<{ brokers: Opt[]; insurers: Opt[] } | null>(null);
  const [broker, setBroker] = useState('');
  const [insurer, setInsurer] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [cred, setCred] = useState<Cred | null>(null);
  const [nc, setNc] = useState({ line: 'LIFE' as Line, policyNumber: '', start: '', end: '', insurerTenantId: '' });
  const [newCo, setNewCo] = useState({ name: '', code: '' });

  useEffect(() => {
    if (!getToken('super')) { router.push('/admin/login'); return; }
    client.get<{ brokers: Opt[]; insurers: Opt[] }>('/admin/policyholders/options', 'super').then((o) => {
      setOpts(o);
      setBroker((o.brokers.find((b) => b.slug === 'damuon') ?? o.brokers[0])?.id ?? '');
      setInsurer((o.insurers.find((i) => i.slug === 'alborz') ?? o.insurers[0])?.id ?? '');
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    if (!broker) return;
    const p = new URLSearchParams({ brokerTenantId: broker }); if (q.trim()) p.set('q', q.trim());
    client.get<Company[]>(`/admin/policyholders?${p}`, 'super').then(setRows).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [broker]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); load(); } catch (e: any) { setError(e.message); }
  };

  const importFile = async (file: File, onProgress: (p: number, e: number | null) => void) => {
    setError(''); setMsg(''); setResult(null);
    const fd = new FormData(); fd.append('file', file); fd.append('brokerTenantId', broker); fd.append('insurerTenantId', insurer);
    const r = await client.upload<ImportResult>('/admin/policyholders/import', fd, 'super', onProgress);
    setResult(r); load();
  };

  const resetPw = (c: Company) => act(async () => {
    if (!confirm(`رمز عبور تازه برای «${c.name}» ساخته شود؟ رمز قبلی دیگر کار نمی‌کند.`)) return;
    setCred(await client.post<Cred>(`/admin/policyholders/${c.id}/password`, {}, 'super'));
  });
  const addContract = (c: Company) => act(async () => {
    await client.post(`/admin/policyholders/${c.id}/contracts`, {
      line: nc.line, policyNumber: toAscii(nc.policyNumber.trim()), insurerTenantId: nc.insurerTenantId || insurer,
      startDate: jToIso(nc.start), endDate: jToIso(nc.end),
    }, 'super');
    setNc({ ...nc, policyNumber: '', start: '', end: '' });
  }, 'بیمه‌نامهٔ جدید افزوده شد');
  const toggleContract = (c: Company, k: Contract) => act(() => client.patch(`/admin/policyholders/${c.id}/contracts/${k.id}`, { isActive: !k.isActive }, 'super'));
  const createCompany = () => act(async () => {
    const r = await client.post<{ id: string }>('/admin/policyholders', { brokerTenantId: broker, name: newCo.name.trim(), code: toAscii(newCo.code.trim()) }, 'super');
    setNewCo({ name: '', code: '' });
    setCred(await client.post<Cred>(`/admin/policyholders/${r.id}/password`, {}, 'super'));
  }, 'بیمه‌گزار افزوده شد');

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">بیمه‌گزاران</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>ورود هر بیمه‌گزار با «کد بیمه‌گزار» و رمز عبور — بیمه‌نامه‌های عمر و حوادث هر سال</p>
        </div>
        <Link href="/admin" className="btn btn-ghost btn-sm">بازگشت به مدیریت سازمان‌ها</Link>
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-sm">کارگزاری
            <select className="input mt-1" value={broker} onChange={(e) => setBroker(e.target.value)}>
              {opts?.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm">بیمه‌گر بیمه‌نامه‌های واردشده
            <select className="input mt-1" value={insurer} onChange={(e) => setInsurer(e.target.value)}>
              {opts?.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <UploadButton className="btn btn-primary w-full" accept=".xlsx" maxMB={10} disabled={!broker || !insurer}
              title="ورود بیمه‌نامه‌ها از اکسل" subtitle="خروجی بیمه‌نامه‌های عمر و حوادث (برگه‌های «عمر جاری» و «حوادث جاری»)"
              note="ستون‌ها: شماره بیمه نامه، بیمه گذار («نام کد ۱۲۳۴۵»)، تاریخ شروع، تاریخ پایان. ورود دوباره همان فایل چیزی را تکراری نمی‌سازد؛ برای سال بعد کافی است خروجی جدید را وارد کنید."
              onUpload={importFile}>ورود از اکسل (سالانه)</UploadButton>
          </div>
        </div>

        {result && (
          <div className="alert-success space-y-1">
            <div className="font-bold">ورود انجام شد.</div>
            <div className="text-sm">
              {result.sheets.map((s) => `${s.name} (${LINE_FA[s.line]}): ${faN(s.rows)} ردیف`).join(' — ')}<br />
              بیمه‌گزار جدید: {faN(result.companiesCreated)} — به‌روزشده: {faN(result.companiesUpdated)} — بیمه‌نامهٔ جدید: {faN(result.contractsCreated)} — به‌روزشده: {faN(result.contractsUpdated)} — تکراری (بدون تغییر): {faN(result.contractsSkipped)}
            </div>
            {result.credentials.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <span className="text-sm font-bold">رمز عبور {faN(result.credentials.length)} بیمه‌گزار ساخته شد؛ همین حالا فایل را ذخیره کنید — دوباره نمایش داده نمی‌شود.</span>
                <button className="btn btn-primary btn-sm" onClick={() => downloadCreds(result.credentials)}>دریافت فایل کد و رمز عبور</button>
              </div>
            )}
            {result.errors.length > 0 && (
              <details><summary className="cursor-pointer text-sm" style={{ color: 'var(--danger)' }}>{faN(result.errors.length)} ردیف وارد نشد</summary>
                <ul className="text-xs mt-1 list-disc mr-4">{result.errors.map((e, i) => <li key={i}>{e.sheet}{e.row ? ` — ردیف ${faN(e.row)}` : ''}: {e.message}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {cred && (
          <div className="alert-success flex items-center gap-2 flex-wrap">
            <span>رمز عبور «{cred.name}» (کد <b className="latin-digits">{cred.code}</b>): <b className="latin-digits" style={{ direction: 'ltr', letterSpacing: '.06em' }}>{cred.password}</b></span>
            <button className="btn btn-ghost btn-sm" onClick={() => downloadCreds([cred], `login-${cred.code}.csv`)}>ذخیره</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCred(null)}>بستن</button>
          </div>
        )}
        <ErrorBox message={error} />
        {msg && <div className="alert-success">{msg}</div>}
      </div>

      <div className="card p-4 grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="text-sm">نام بیمه‌گزار جدید<input className="input mt-1" value={newCo.name} onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} /></label>
        <label className="text-sm">کد بیمه‌گزار<input className="input mt-1 latin-digits" style={{ direction: 'ltr', textAlign: 'right' }} value={newCo.code} onChange={(e) => setNewCo({ ...newCo, code: e.target.value })} /></label>
        <button className="btn btn-ghost" disabled={newCo.name.trim().length < 2 || !newCo.code.trim()} onClick={createCompany}>افزودن بیمه‌گزار</button>
      </div>

      <div className="card">
        <div className="p-4 flex gap-2 flex-wrap items-center border-b" style={{ borderColor: 'var(--border)' }}>
          <input className="input" style={{ maxWidth: 320 }} placeholder="جستجو: نام، کد بیمه‌گزار یا شماره بیمه‌نامه" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className="btn btn-ghost btn-sm" onClick={load}>جستجو</button>
          {rows && <span className="text-sm mr-auto" style={{ color: 'var(--muted)' }}>{faN(rows.length)} بیمه‌گزار</span>}
        </div>
        {!rows ? <div className="p-10 flex justify-center"><Spinner /></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr>{['کد بیمه‌گزار', 'نام بیمه‌گزار', 'رشته‌ها', 'بیمه‌نامهٔ جاری', 'ورود', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--muted)' }}>بیمه‌گزاری یافت نشد</td></tr> : rows.map((c) => {
                  const current = c.contracts.filter((k) => k.inForce);
                  return [
                    <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.55 }}>
                      <td className="latin-digits">{c.code || '—'}</td>
                      <td className="font-semibold">{c.name}</td>
                      <td>{c.lines.length ? c.lines.map((l) => <span key={l} className={`badge ${l === 'LIFE' ? 'badge-success' : 'badge-warning'} ml-1`}>{LINE_FA[l]}</span>) : '—'}</td>
                      <td className="text-xs">{current.length ? current.map((k) => `${k.lineLabel ?? ''} ${k.policyNumber ?? ''}`).join(' — ') : <span style={{ color: 'var(--danger)' }}>بیمه‌نامهٔ جاری ندارد</span>}</td>
                      <td className="text-xs">{c.hasPassword ? <span className="badge badge-success">دارد</span> : <span className="badge badge-danger">ندارد</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'بستن' : 'بیمه‌نامه‌ها'}</button>
                        <button className="btn btn-ghost btn-sm" disabled={!c.code} onClick={() => resetPw(c)}>{c.hasPassword ? 'رمز تازه' : 'ساخت رمز'}</button>
                      </td>
                    </tr>,
                    open === c.id && (
                      <tr key={`${c.id}-x`}>
                        <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                          <table className="table" style={{ background: 'var(--surface)' }}>
                            <thead><tr>{['رشته', 'شماره بیمه‌نامه', 'بیمه‌گر', 'شروع', 'پایان', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                              {c.contracts.map((k) => (
                                <tr key={k.id} style={{ opacity: k.isActive ? 1 : 0.5 }}>
                                  <td>{k.lineLabel ?? '—'}</td><td className="latin-digits">{k.policyNumber ?? '—'}</td><td>{k.insurerName}</td>
                                  <td>{k.startDate ?? '—'}</td><td>{k.endDate ?? '—'}</td>
                                  <td>{!k.isActive ? 'غیرفعال' : k.inForce ? <span className="badge badge-success">جاری</span> : 'خارج از دوره'}</td>
                                  <td><button className="btn btn-ghost btn-sm" onClick={() => toggleContract(c, k)}>{k.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="grid sm:grid-cols-6 gap-2 items-end mt-3">
                            <label className="text-xs">رشته<select className="input mt-1" value={nc.line} onChange={(e) => setNc({ ...nc, line: e.target.value as Line })}><option value="LIFE">عمر</option><option value="ACCIDENT">حوادث</option></select></label>
                            <label className="text-xs">شماره بیمه‌نامهٔ جدید<input className="input mt-1 latin-digits" style={{ direction: 'ltr', textAlign: 'right' }} value={nc.policyNumber} onChange={(e) => setNc({ ...nc, policyNumber: e.target.value })} /></label>
                            <label className="text-xs">بیمه‌گر<select className="input mt-1" value={nc.insurerTenantId || insurer} onChange={(e) => setNc({ ...nc, insurerTenantId: e.target.value })}>{opts?.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
                            <div className="text-xs">تاریخ شروع<div className="mt-1"><JalaliDatePicker value={nc.start} onChange={(v) => setNc({ ...nc, start: v })} placeholder="شروع" /></div></div>
                            <div className="text-xs">تاریخ پایان<div className="mt-1"><JalaliDatePicker value={nc.end} onChange={(v) => setNc({ ...nc, end: v })} placeholder="پایان" /></div></div>
                            <button className="btn btn-primary btn-sm" disabled={!nc.policyNumber.trim()} onClick={() => addContract(c)}>افزودن بیمه‌نامهٔ سال جدید</button>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
