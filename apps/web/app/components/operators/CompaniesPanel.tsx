'use client';
import { Fragment, useEffect, useState } from 'react';
import { toGregorian } from 'jalaali-js';
import { client } from '../../../lib/client';
import { JalaliDatePicker } from '../JalaliDatePicker';
import { ErrorBox, Field, Overlay } from '../ui';

interface Contract { id: string; line: string | null; lineLabel: string | null; policyNumber: string | null; insurerTenantId: string; insurerName: string; startDate: string | null; endDate: string | null; isActive: boolean; inForce: boolean }
interface Company { id: string; name: string; code: string | null; isActive: boolean; hasPassword: boolean; mustChangePassword?: boolean; contracts: Contract[] }
interface Options { insurers: { id: string; name: string }[]; kinds: { code: string; label: string }[] }
interface Cred { code: string; name: string; password: string }

const BASE = '/policyholder-companies/manage';
const faN = (n: number) => n.toLocaleString('fa-IR');
const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const jToIso = (v: string) => {
  const p = toAscii(v).split('/').map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => !n)) return null;
  const { gy, gm, gd } = toGregorian(p[0], p[1], p[2]);
  return new Date(gy, gm - 1, gd).toISOString();
};
const emptyK = { line: '', policyNumber: '', insurerTenantId: '', start: '', end: '' };

/**
 * «شرکت‌های بیمه‌گزار» (a brokerage's admin, panel 2): each company's panel-1 login — «کد بیمه‌گزار» +
 * password, used at «ورود برای بارگذاری مدارک › بیمه‌گزار / نماینده» — and its yearly بیمه‌نامه‌ها with the
 * insurers this brokerage cooperates with. A new company starts with the default password (Aa123456) and
 * is asked to change it at first sign-in. A company with cases can't be deleted (deactivate it instead).
 */
export function CompaniesPanel() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [rows, setRows] = useState<Company[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [cred, setCred] = useState<Cred | null>(null);
  const [nco, setNco] = useState({ name: '', code: '', ...emptyK });
  const [nk, setNk] = useState(emptyK);
  const [editCo, setEditCo] = useState<{ id: string; name: string; code: string; isActive: boolean } | null>(null);
  const [editK, setEditK] = useState<{ companyId: string; id: string; line: string; policyNumber: string; insurerTenantId: string; start: string; end: string; isActive: boolean } | null>(null);

  const load = () => client.get<Company[]>(`${BASE}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, 'org').then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    client.get<Options>(`${BASE}/options`, 'org').then((o) => {
      setOpts(o);
      const d = { ...emptyK, line: o.kinds[0]?.code ?? '', insurerTenantId: o.insurers[0]?.id ?? '' };
      setNk(d); setNco((c) => ({ ...c, line: d.line, insurerTenantId: d.insurerTenantId }));
    }).catch((e) => setError(e.message));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(''); setMsg(''); setBusy(true);
    try { await fn(); if (ok) setMsg(ok); await load(); return true; } catch (e: any) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const dates = (start: string, end: string) => {
    const startDate = start ? jToIso(start) : null; const endDate = end ? jToIso(end) : null;
    if ((start && !startDate) || (end && !endDate)) throw new Error('تاریخ نامعتبر است (نمونه: ۱۴۰۵/۰۹/۰۱)');
    return { startDate, endDate };
  };

  const create = () => act(async () => {
    const first = nco.policyNumber.trim() ? { insurerTenantId: nco.insurerTenantId, line: nco.line, policyNumber: toAscii(nco.policyNumber.trim()), ...dates(nco.start, nco.end) } : {};
    await client.post(BASE, { name: nco.name.trim(), code: toAscii(nco.code.trim()), ...first }, 'org');
    setNco({ ...nco, name: '', code: '', policyNumber: '', start: '', end: '' });
  }, 'بیمه‌گزار افزوده شد — رمز عبور اولیه: Aa123456 (در اولین ورود تغییر می‌کند).');
  const saveCompany = async () => {
    if (!editCo) return;
    if (await act(() => client.patch(`${BASE}/${editCo.id}`, { name: editCo.name.trim(), code: toAscii(editCo.code.trim()), isActive: editCo.isActive }, 'org'), 'مشخصات بیمه‌گزار ذخیره شد.')) setEditCo(null);
  };
  const password = (c: Company, custom: boolean) => act(async () => {
    let pw: string | undefined;
    if (custom) {
      const v = window.prompt(`رمز عبور تازهٔ «${c.name}» (دست‌کم ۸ نویسه):`, '');
      if (v === null) return;
      pw = v.trim();
      if (pw.length < 8) throw new Error('رمز عبور باید دست‌کم ۸ نویسه باشد');
    } else if (!window.confirm(`رمز عبور «${c.name}» به رمز پیش‌فرض (Aa123456) برگردد؟ رمز فعلی دیگر کار نمی‌کند.`)) return;
    setCred(await client.post<Cred>(`${BASE}/${c.id}/password`, pw ? { password: pw } : {}, 'org'));
  });
  const remove = (c: Company) => {
    if (!window.confirm(`«${c.name}» برای همیشه حذف شود؟\nبیمه‌نامه‌ها، ورود پنل و نمایندگان آن هم حذف می‌شوند. اگر پروندهٔ خسارت داشته باشد حذف نمی‌شود؛ در آن صورت آن را غیرفعال کنید.`)) return;
    act(async () => {
      const r = await client.del<{ deleted: number; skipped: { name: string; reason: string }[] }>(`${BASE}/${c.id}`, 'org');
      if (r.skipped.length) throw new Error(`«${c.name}» حذف نشد: ${r.skipped[0].reason}؛ به‌جای حذف آن را غیرفعال کنید.`);
    }, 'بیمه‌گزار حذف شد.');
  };
  const addContract = (c: Company) => act(async () => {
    await client.post(`${BASE}/${c.id}/contracts`, { line: nk.line, policyNumber: toAscii(nk.policyNumber.trim()), insurerTenantId: nk.insurerTenantId, ...dates(nk.start, nk.end) }, 'org');
    setNk({ ...nk, policyNumber: '', start: '', end: '' });
  }, 'بیمه‌نامه افزوده شد.');
  const saveContract = async () => {
    if (!editK) return;
    const ok = await act(() => client.patch(`${BASE}/${editK.companyId}/contracts/${editK.id}`, { line: editK.line, policyNumber: toAscii(editK.policyNumber.trim()), insurerTenantId: editK.insurerTenantId, isActive: editK.isActive, ...dates(editK.start, editK.end) }, 'org'), 'بیمه‌نامه ذخیره شد.');
    if (ok) setEditK(null);
  };

  const noInsurer = opts && !opts.insurers.length;
  const insurerSel = (v: string, on: (v: string) => void) => (
    <select className="input" value={v} onChange={(e) => on(e.target.value)}>{opts?.insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
  );
  const kindSel = (v: string, on: (v: string) => void) => (
    <select className="input" value={v} onChange={(e) => on(e.target.value)}>{opts?.kinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</select>
  );

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {msg && <div className="alert-success">{msg}</div>}
      {cred && (
        <div className="pinfobox text-sm space-y-1">
          <div>ورود پنل «{cred.name}» — این رمز فقط همین یک بار نمایش داده می‌شود:</div>
          <div>کد بیمه‌گزار (نام کاربری): <bdi className="latin-digits font-bold">{cred.code}</bdi> — رمز عبور: <bdi className="latin-digits font-bold">{cred.password}</bdi></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setCred(null)}>بستن</button>
        </div>
      )}
      {noInsurer && <div className="alert-error">این کارگزاری هنوز با هیچ بیمه‌گری همکاری فعال ندارد؛ اتصال به بیمه‌گر را مدیر سامانه برقرار می‌کند. تا آن زمان بیمه‌نامه‌ای ثبت نمی‌شود.</div>}

      <section className="card p-4 space-y-3">
        <h3 className="font-bold text-sm">افزودن شرکت بیمه‌گزار</h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>بیمه‌گزار با «کد بیمه‌گزار» و رمز عبور از «ورود برای بارگذاری مدارک › بیمه‌گزار / نماینده» وارد پنل ۱ می‌شود. بیمه‌نامهٔ اول اختیاری است و بعداً هم افزوده می‌شود؛ بدون بیمه‌نامهٔ فعال، پرونده‌ای ثبت نمی‌شود.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="نام شرکت *"><input className="input" value={nco.name} onChange={(e) => setNco({ ...nco, name: e.target.value })} /></Field>
          <Field label="کد بیمه‌گزار (نام کاربری) *"><input className="input latin-digits" value={nco.code} onChange={(e) => setNco({ ...nco, code: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="بیمه‌گر (بیمه‌نامهٔ اول)">{insurerSel(nco.insurerTenantId, (v) => setNco({ ...nco, insurerTenantId: v }))}</Field>
          <Field label="نوع بیمه‌نامه">{kindSel(nco.line, (v) => setNco({ ...nco, line: v }))}</Field>
          <Field label="شماره بیمه‌نامه (اختیاری)"><input className="input latin-digits" value={nco.policyNumber} onChange={(e) => setNco({ ...nco, policyNumber: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
          <Field label="تاریخ شروع"><JalaliDatePicker value={nco.start} onChange={(v) => setNco({ ...nco, start: v })} placeholder="شروع" /></Field>
          <Field label="تاریخ پایان"><JalaliDatePicker value={nco.end} onChange={(v) => setNco({ ...nco, end: v })} placeholder="پایان" /></Field>
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy || nco.name.trim().length < 2 || !nco.code.trim() || (!!nco.policyNumber.trim() && (!nco.insurerTenantId || !nco.start || !nco.end))} onClick={create}>افزودن بیمه‌گزار</button>
      </section>

      <div className="flex gap-2">
        <input className="input" style={{ maxWidth: 320 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} placeholder="جستجوی نام، کد بیمه‌گزار یا شماره بیمه‌نامه…" />
        <button className="btn btn-ghost btn-sm" onClick={load}>جستجو</button>
      </div>

      <section className="card p-0 overflow-x-auto">
        <table className="table w-full text-sm">
          <thead><tr><th>شرکت بیمه‌گزار</th><th>کد بیمه‌گزار</th><th>بیمه‌نامه‌ها</th><th>رمز عبور</th><th>وضعیت</th><th /></tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={6} className="text-center py-6">…</td></tr>
              : !rows.length ? <tr><td colSpan={6} className="text-center py-6" style={{ color: 'var(--muted)' }}>بیمه‌گزاری نیست.</td></tr>
              : rows.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td className="font-semibold"><button className="text-right" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? '▾' : '▸'} {c.name}</button></td>
                    <td><bdi className="latin-digits">{c.code || '—'}</bdi></td>
                    <td>{faN(c.contracts.filter((k) => k.isActive).length)} فعال{c.contracts.some((k) => k.inForce) ? '' : <span className="badge badge-warning mr-1">بدون بیمه‌نامهٔ جاری</span>}</td>
                    <td className="text-xs">{!c.hasPassword ? '—' : c.mustChangePassword ? <span className="badge badge-warning">پیش‌فرض</span> : <span className="badge badge-success">تنظیم شده</span>}</td>
                    <td>{c.isActive ? <span className="badge badge-success">فعال</span> : <span className="badge badge-neutral">غیرفعال</span>}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditCo({ id: c.id, name: c.name, code: c.code ?? '', isActive: c.isActive })}>ویرایش</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy || !c.code} onClick={() => password(c, true)}>تعیین رمز</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy || !c.code} onClick={() => password(c, false)}>رمز پیش‌فرض</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => remove(c)}>حذف</button>
                    </td>
                  </tr>
                  {open === c.id && (
                    <tr><td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                      <div className="space-y-2 p-1">
                        {c.contracts.length ? (
                          <table className="table w-full text-xs">
                            <thead><tr><th>نوع</th><th>شماره</th><th>بیمه‌گر</th><th>بازه</th><th>وضعیت</th><th /></tr></thead>
                            <tbody>
                              {c.contracts.map((k) => (
                                <tr key={k.id}>
                                  <td>{k.lineLabel || '—'}</td>
                                  <td><bdi className="latin-digits">{k.policyNumber || '—'}</bdi></td>
                                  <td>{k.insurerName}</td>
                                  <td>{k.startDate || '…'} تا {k.endDate || '…'}</td>
                                  <td>{!k.isActive ? <span className="badge badge-neutral">غیرفعال</span> : k.inForce ? <span className="badge badge-success">جاری</span> : <span className="badge badge-neutral">خارج از بازه</span>}</td>
                                  <td className="whitespace-nowrap">
                                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditK({ companyId: c.id, id: k.id, line: k.line ?? opts?.kinds[0]?.code ?? '', policyNumber: k.policyNumber ?? '', insurerTenantId: k.insurerTenantId, start: k.startDate ?? '', end: k.endDate ?? '', isActive: k.isActive })}>ویرایش</button>
                                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.patch(`${BASE}/${c.id}/contracts/${k.id}`, { isActive: !k.isActive }, 'org'))}>{k.isActive ? 'غیرفعال' : 'فعال'}</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <p className="text-xs" style={{ color: 'var(--muted)' }}>هنوز بیمه‌نامه‌ای ندارد.</p>}
                        {!noInsurer && (
                          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 items-end">
                            <Field label="بیمه‌گر">{insurerSel(nk.insurerTenantId, (v) => setNk({ ...nk, insurerTenantId: v }))}</Field>
                            <Field label="نوع">{kindSel(nk.line, (v) => setNk({ ...nk, line: v }))}</Field>
                            <Field label="شماره بیمه‌نامه"><input className="input latin-digits" value={nk.policyNumber} onChange={(e) => setNk({ ...nk, policyNumber: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
                            <Field label="شروع"><JalaliDatePicker value={nk.start} onChange={(v) => setNk({ ...nk, start: v })} placeholder="شروع" /></Field>
                            <Field label="پایان"><JalaliDatePicker value={nk.end} onChange={(v) => setNk({ ...nk, end: v })} placeholder="پایان" /></Field>
                            <button className="btn btn-primary btn-sm" disabled={busy || !nk.policyNumber.trim() || !nk.start || !nk.end || !nk.insurerTenantId} onClick={() => addContract(c)}>افزودن بیمه‌نامه</button>
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
          </tbody>
        </table>
      </section>

      {editCo && (
        <Overlay onClose={() => setEditCo(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head"><span className="pmodal-title">ویرایش بیمه‌گزار</span><button className="pmodal-x" onClick={() => setEditCo(null)} aria-label="بستن">×</button></div>
            <div className="pmodal-body space-y-3">
              <Field label="نام شرکت"><input className="input" value={editCo.name} onChange={(e) => setEditCo({ ...editCo, name: e.target.value })} /></Field>
              <Field label="کد بیمه‌گزار (نام کاربری ورود)"><input className="input latin-digits" value={editCo.code} onChange={(e) => setEditCo({ ...editCo, code: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={editCo.isActive} onChange={(e) => setEditCo({ ...editCo, isActive: e.target.checked })} /> فعال (غیرفعال = ورود به پنل و ثبت پرونده بسته است)</label>
              <ErrorBox message={error} />
            </div>
            <div className="ur-modal-btns">
              <button className="btn btn-primary btn-sm" disabled={busy || editCo.name.trim().length < 2} onClick={saveCompany}>{busy ? '…' : 'ذخیره'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditCo(null)}>انصراف</button>
            </div>
          </div>
        </Overlay>
      )}
      {editK && (
        <Overlay onClose={() => setEditK(null)}>
          <div className="pmodal ur-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head"><span className="pmodal-title">ویرایش بیمه‌نامه</span><button className="pmodal-x" onClick={() => setEditK(null)} aria-label="بستن">×</button></div>
            <div className="pmodal-body space-y-3">
              <Field label="بیمه‌گر">{insurerSel(editK.insurerTenantId, (v) => setEditK({ ...editK, insurerTenantId: v }))}</Field>
              <Field label="نوع بیمه‌نامه">{kindSel(editK.line, (v) => setEditK({ ...editK, line: v }))}</Field>
              <Field label="شماره بیمه‌نامه"><input className="input latin-digits" value={editK.policyNumber} onChange={(e) => setEditK({ ...editK, policyNumber: e.target.value })} style={{ direction: 'ltr', textAlign: 'right' }} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="تاریخ شروع"><JalaliDatePicker value={editK.start} onChange={(v) => setEditK({ ...editK, start: v })} placeholder="شروع" /></Field>
                <Field label="تاریخ پایان"><JalaliDatePicker value={editK.end} onChange={(v) => setEditK({ ...editK, end: v })} placeholder="پایان" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={editK.isActive} onChange={(e) => setEditK({ ...editK, isActive: e.target.checked })} /> فعال</label>
              <ErrorBox message={error} />
            </div>
            <div className="ur-modal-btns">
              <button className="btn btn-primary btn-sm" disabled={busy || !editK.policyNumber.trim()} onClick={saveContract}>{busy ? '…' : 'ذخیره'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditK(null)}>انصراف</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
