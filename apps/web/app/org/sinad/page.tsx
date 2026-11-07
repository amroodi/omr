'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox, FancyLoader, Overlay, Spinner, StatusBadge } from '../../components/ui';
import { ORG_NAV } from '../nav';
import { INSURED_RELATIONS as RELATION_FA } from '../../components/claim-wording';

/**
 * «کارتابل» — the شعبه / ستاد kartable of an insurer on «روند سیناد» (Alborz): Sinad's stage tiles across
 * the top, the selected stage's cases below with Sinad's columns and row operations. Cases at شعبه are
 * allocated to one evaluator in batches; the actions themselves are the chain's own (see the API).
 */
interface Tab { key: string; label: string; count: number }
interface Kartable { enabled: boolean; stage?: string; stageLabel?: string; admin?: boolean; batchSize?: number; pool?: number; tabs?: Tab[] }
interface Row {
  id: string; claimNumber: string; status: string; claimTypeLabel?: string | null; lineLabel?: string | null; deceasedName: string | null; deceasedNationalCode?: string | null;
  insuredRelation?: string | null; estimatedAmount?: string; finalizedAmount?: string | null; eventDate?: string | null; createdAt?: string | null; policyNumber?: string | null;
  companyName?: string | null; currentStageLabel?: string | null; needsAction?: boolean; evaluatorName?: string | null; evaluatorAt?: string | null; doctorNote?: string | null;
  physicalAt?: string | null; branchName?: string | null; firstApproval?: { amount: string | null; by: string | null; at: string | null; note: string | null } | null;
}

const fa = (n: number) => n.toLocaleString('fa-IR');
const amt = (v?: string | null) => (v ? Number(v).toLocaleString('fa-IR') : '—');

export default function SinadPage() {
  return <Suspense fallback={null}><Kartable /></Suspense>;
}

function Kartable() {
  const router = useRouter();
  const params = useSearchParams();
  const [k, setK] = useState<Kartable | null>(null);
  const [tab, setTab] = useState<string>(params.get('tab') || '');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [opinion, setOpinion] = useState<{ id: string; name: string } | null>(null);
  const [opinionText, setOpinionText] = useState('');
  const size = 15;

  const loadTabs = () => client.get<Kartable>('/claims/sinad/kartable', 'org').then((d) => {
    if (!d.enabled) { router.replace('/org/work-desk?classic=1'); return; }
    setK(d);
    setTab((t) => t || (d.tabs?.find((x) => x.key === 'evaluate') ? 'evaluate' : d.tabs?.[0]?.key) || '');
  }).catch((e) => setError(e.message));
  const loadRows = (key: string) => {
    setRows(null); setPage(1);
    client.get<Row[]>(`/claims/sinad/kartable/${key}`, 'org').then(setRows).catch((e) => { setRows([]); setError(e.message); });
  };
  useEffect(() => { if (!getToken('org')) { router.push('/org/login'); return; } loadTabs(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!tab) return;
    loadRows(tab);
    const u = new URL(window.location.href); u.searchParams.set('tab', tab); window.history.replaceState(null, '', u.toString());
    // «در انتظار ارزیابی اولیه» may have handed out a new batch: refresh the counts after it.
    if (tab === 'evaluate') setTimeout(() => loadTabs(), 400);
    /* eslint-disable-next-line */
  }, [tab]);

  const op = async (id: string, name: string, body: Record<string, string> = {}) => {
    setError(''); setBusy(true);
    try { await client.post(`/claims/${id}/sinad/${name}`, body, 'org'); loadRows(tab); loadTabs(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const shown = useMemo(() => {
    const t = q.trim();
    if (!rows) return [];
    if (!t) return rows;
    return rows.filter((r) => [r.claimNumber, r.deceasedName, r.deceasedNationalCode, r.policyNumber, r.companyName].some((x) => (x || '').includes(t)));
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const slice = shown.slice((page - 1) * size, page * size);
  const cur = k?.tabs?.find((t) => t.key === tab);
  const evalTab = tab === 'evaluate' || tab === 'later' || tab === 'doctor' || tab === 'exam';

  return (
    <Shell title="کارتابل" breadcrumb={cur?.label || 'کارتابل'} nav={ORG_NAV} realm="org"
      action={<Link href="/org/work-desk?classic=1" className="btn btn-ghost btn-sm">جستجوی پیشرفته</Link>}>
      <ErrorBox message={error} />
      {!k ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال بارگذاری کارتابل…" /></div> : (
        <div className="sk">
          <div className="sk-user">
            <span>میز کار: <b>{k.stageLabel}</b></span>
            {k.stage === 'BRANCH' && !k.admin && <span className="sk-pool">پرونده‌های تخصیص‌نیافتهٔ شعبه: <b>{fa(k.pool ?? 0)}</b> — هر بار {fa(k.batchSize ?? 10)} پرونده به شما تخصیص می‌یابد</span>}
          </div>
          <div className="sk-tiles" role="tablist">
            {k.tabs?.map((t, i) => (
              <button key={t.key} role="tab" aria-selected={t.key === tab} className={`sk-tile${t.key === tab ? ' is-on' : ''}`} onClick={() => setTab(t.key)}>
                <span className="sk-tile-n">{fa(i + 1)}</span>
                <span className="sk-tile-l">{t.label}</span>
                <span className="sk-tile-c">{fa(t.count)}</span>
              </button>
            ))}
          </div>

          <div className="sk-box">
            <div className="sk-bar">
              <b>{cur?.label}</b>
              <span className="sk-grow" />
              <input className="input sk-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="جستجو: کد ملی، نام، شماره پرونده یا بیمه‌نامه" />
              <button className="btn btn-ghost btn-sm" onClick={() => { loadRows(tab); loadTabs(); }} disabled={busy}>بروز رسانی</button>
            </div>
            {tab === 'evaluate' && !k.admin && rows && rows.length === 0 && (
              <div className="sk-empty">پرونده‌ای در کارتابل شما نیست{(k.pool ?? 0) > 0 ? '' : ' و پرونده‌ای هم در انتظار تخصیص نیست'}.</div>
            )}
            {!rows ? <div className="py-10 flex justify-center"><Spinner /></div> : (
              <div className="sk-scroll">
                <table className="sk-table">
                  <thead>
                    <tr>
                      <th>ردیف</th><th>عملیات</th><th>کد ملی</th><th>نام</th><th>نسبت</th><th>نوع پرونده</th><th>نوع بیمه‌نامه</th>
                      <th>تاریخ وقوع</th><th>مبلغ اعلامی</th><th>مبلغ تایید شده</th>
                      {tab === 'final' && <><th>کاربر تایید اولیه</th><th>تاریخ تایید اولیه</th><th>توضیحات تایید اولیه</th></>}
                      {(tab === 'doctor' || tab === 'exam') && <th>اظهار نظر پزشک معتمد</th>}
                      <th>زمان ثبت</th><th>شماره پرونده</th><th>شماره بیمه‌نامه</th><th>بیمه‌گذار</th><th>ارزیاب</th><th>تحویل مدارک</th><th>مرحله</th><th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map((r, i) => (
                      <tr key={r.id} className={r.needsAction ? 'is-mine' : ''}>
                        <td>{fa((page - 1) * size + i + 1)}</td>
                        <td className="sk-ops">
                          {evalTab && r.needsAction && <button className="sk-op is-main" onClick={() => router.push(`/org/claims/${r.id}/evaluate`)}>ارزیابی</button>}
                          {(tab === 'doctor' || tab === 'exam') && <button className="sk-op" onClick={() => { setOpinionText(''); setOpinion({ id: r.id, name: r.deceasedName || r.claimNumber }); }}>اظهار نظر پزشک معتمد</button>}
                          {tab === 'final' && r.needsAction && <button className="sk-op is-main" onClick={() => router.push(`/org/claims/${r.id}/evaluate`)}>ارزیابی نهایی</button>}
                          {(tab === 'returned' || tab === 'pay') && r.needsAction && <button className="sk-op is-main" onClick={() => router.push(`/org/claims/${r.id}/evaluate`)}>اقدام</button>}
                          {(tab === 'evaluate' || tab === 'later') && r.evaluatorName && <button className="sk-op" disabled={busy} onClick={() => op(r.id, 'release')} title="پرونده به پرونده‌های تخصیص‌نیافتهٔ شعبه برمی‌گردد">خارج کردن از کارتابل</button>}
                          {(tab === 'evaluate') && k.admin && !r.evaluatorName && <button className="sk-op" disabled={busy} onClick={() => op(r.id, 'take')}>برداشتن</button>}
                          <button className="sk-op" onClick={() => router.push(`/org/claims/${r.id}`)}>مشاهده</button>
                        </td>
                        <td className="ltr">{r.deceasedNationalCode || '—'}</td>
                        <td>{r.deceasedName || '—'}</td>
                        <td>{r.insuredRelation ? RELATION_FA[r.insuredRelation] ?? r.insuredRelation : 'اصلی'}</td>
                        <td>{r.claimTypeLabel || '—'}</td>
                        <td>{r.lineLabel || '—'}</td>
                        <td>{r.eventDate || '—'}</td>
                        <td>{amt(r.estimatedAmount)}</td>
                        <td>{amt(r.finalizedAmount)}</td>
                        {tab === 'final' && <><td>{r.firstApproval?.by || '—'}</td><td>{r.firstApproval?.at || '—'}</td><td className="sk-note">{r.firstApproval?.note || '—'}</td></>}
                        {(tab === 'doctor' || tab === 'exam') && <td className="sk-note">{r.doctorNote || '—'}</td>}
                        <td>{r.createdAt || '—'}</td>
                        <td>{r.claimNumber}</td>
                        <td>{r.policyNumber || '—'}</td>
                        <td>{r.companyName || '—'}</td>
                        <td>{r.evaluatorName || '—'}</td>
                        <td>{r.physicalAt && r.physicalAt !== 'POLICYHOLDER' && r.physicalAt !== 'BROKER' ? 'تحویل شده' : 'تحویل نشده'}</td>
                        <td>{r.currentStageLabel || '—'}</td>
                        <td><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                    {slice.length === 0 && <tr><td colSpan={30} className="sk-none">موردی برای نمایش وجود ندارد.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {rows && shown.length > size && (
              <div className="sk-pager">
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</button>
                <span>صفحهٔ {fa(page)} از {fa(pages)} — {fa(shown.length)} مورد</span>
                <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</button>
              </div>
            )}
          </div>
        </div>
      )}

      {opinion && (
        <Overlay onClose={() => setOpinion(null)}>
          <div className="pmodal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="pmodal-head">
              <span className="pmodal-title">اظهار نظر پزشک معتمد — {opinion.name}</span>
              <button className="pmodal-x" onClick={() => setOpinion(null)} aria-label="بستن">×</button>
            </div>
            <div className="pmodal-body space-y-2 text-sm">
              <textarea className="input" rows={5} maxLength={1000} value={opinionText} onChange={(e) => setOpinionText(e.target.value)} placeholder="نظر پزشک معتمد دربارهٔ پرونده (مثلاً درصد نقص عضو، ارتباط علت با حادثه)" />
              <div className="text-xs" style={{ color: 'var(--muted)' }}>پس از ثبت، پرونده به «در انتظار ارزیابی اولیه» ارزیاب خود برمی‌گردد.</div>
            </div>
            <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setOpinion(null)} className="flex-1 py-3 font-bold" style={{ color: 'var(--muted)', borderInlineEnd: '1px solid var(--border)' }}>انصراف</button>
              <button disabled={busy || !opinionText.trim()} onClick={() => { const o = opinion; setOpinion(null); op(o.id, 'doctor-opinion', { note: opinionText.trim() }); }} className="flex-1 py-3 font-bold" style={{ color: 'var(--brand-700)' }}>ثبت اظهار نظر</button>
            </div>
          </div>
        </Overlay>
      )}
    </Shell>
  );
}
