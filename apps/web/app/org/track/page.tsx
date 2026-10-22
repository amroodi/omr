'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken } from '../../../lib/client';
import { Shell, Icon } from '../../components/Shell';
import { ORG_NAV } from '../nav';
import { ClaimTypeBadge, CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, StatusBadge } from '../../components/ui';

interface Row { id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null; insurerTenantId?: string }
interface DocReview { stage: string; state: string }
interface Doc { id: string; fileName: string; status: string; statusLabel: string; reviews?: DocReview[] }
interface Item { code: string; label: string; uploaded: boolean; documents: Doc[] }
interface Checklist { complete: boolean; items: Item[]; otherDocuments?: Doc[] }
interface Step { order: number; partyType: string; state: string; holderName?: string | null; branchName?: string | null; decidedByName?: string | null; decidedAt?: string | null }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  estimatedAmount?: string; claimedAmount: string; finalizedAmount?: string | null; payableAmount?: string;
  eventDate: string | null; noticeDeadline: string | null; createdAt: string | null;
  insurer?: { name: string } | null; broker?: { name: string } | null; sellingBranchName?: string | null;
  policyHolder?: { name: string | null; nationalCode: string | null } | null; steps?: Step[];
}

const DOC_BADGE: Record<string, string> = { PENDING: 'badge-warning', VERIFIED: 'badge-success', REJECTED: 'badge-danger', NEEDS_INFO: 'badge-warning' };
const STEP_PARTY: Record<string, string> = { POLICYHOLDER: 'بیمه‌گزار', MOAREF: 'معرف', INSURER_LEVEL: 'سطح بیمه‌گر' };
const STAGE_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', COUNCIL: 'ستاد' };
const EYE = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z';
const amt = (v?: string | null) => (v ? `${Number(v).toLocaleString('fa-IR')} ریال` : null);

export default function TrackClaim() {
  const router = useRouter();
  const [nid, setNid] = useState('');
  const [name, setName] = useState('');
  const [results, setResults] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [insurers, setInsurers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken('org')) { router.push('/org/login'); return; }
    client.get<{ id: string; name: string }[]>('/claims/insurers', 'org').then((a) => setInsurers(Object.fromEntries(a.map((i) => [i.id, i.name])))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const search = () => {
    const p = new URLSearchParams();
    const n = toAscii(nid).replace(/\D/g, ''); if (n) p.set('deceasedNationalCode', n);
    if (name.trim()) p.set('deceasedName', name.trim());
    if (![...p.keys()].length) { setError('کد ملی یا نام متوفی را وارد کنید'); return; }
    setError(''); setSel(null); setResults(null); setLoading(true);
    client.get<Row[]>(`/claims/search?${p.toString()}`, 'org').then(setResults).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  const open = (id: string) => {
    setError(''); setLoading(true);
    Promise.all([client.get<Claim>(`/claims/${id}`, 'org'), client.get<Checklist>(`/claims/${id}/checklist`, 'org')])
      .then(([c, cl]) => { setSel(c); setChecklist(cl); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  const viewDoc = (docId: string) => { if (sel) client.view(`/claims/${sel.id}/documents/${docId}/file`, 'org').catch((e) => setError(e.message)); };

  const info: [string, any][] = sel ? [
    ['بیمه‌شده (متوفی)', sel.deceasedName],
    ['بیمه‌گزار', sel.policyHolder?.name],
    ['معرف (کارگزاری)', sel.broker?.name],
    ['بیمه‌گر', sel.insurer ? `${sel.insurer.name}${sel.sellingBranchName ? ` — ${sel.sellingBranchName}` : ''}` : null],
    ['مبلغ برآوردی', amt(sel.estimatedAmount ?? sel.claimedAmount)],
    ['مبلغ قطعی', amt(sel.finalizedAmount)],
    ['مبلغ قابل پرداخت', amt(sel.payableAmount)],
    ['تاریخ وقوع', sel.eventDate],
    ['مهلت اعلام', sel.noticeDeadline],
    ['تاریخ ثبت', sel.createdAt],
  ] : [];

  return (
    <Shell title="پیگیری آخرین وضعیت پرونده خسارت" breadcrumb="پیگیری پرونده" nav={ORG_NAV} realm="org">
      {/* Search */}
      <div className="pcard p-5 pform mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="input" placeholder="کد ملی بیمه‌شده (متوفی)" value={nid} onChange={(e) => setNid(e.target.value)} inputMode="numeric" />
          <input className="input" placeholder="نام بیمه‌شده (متوفی)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <div className="flex justify-end mt-3"><button onClick={search} className="btn btn-solid btn-sm px-8">جستجو</button></div>
      </div>

      <ErrorBox message={error} />

      {loading ? (
        <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال جستجو…" /></div>
      ) : sel ? (
        /* ── Selected claim: پیگیری view ── */
        <div className="space-y-5">
          {/* Navy rounded-top header card (designer) */}
          <div className="trk-head">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="trk-title">پیگیری آخرین وضعیت پرونده خسارت</div>
                {(sel.policyHolder?.name || sel.deceasedName) && <div className="trk-sub">{sel.policyHolder?.name || sel.deceasedName}</div>}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <span className="font-bold">پرونده {sel.claimNumber}</span>
                  <StatusBadge status={sel.status} />
                  <ClaimTypeBadge type={sel.claimType} />
                </div>
              </div>
              <div className="flex items-center gap-2 no-print">
                <button onClick={() => setSel(null)} className="trk-btn-back"><Icon path="M9 18l6-6-6-6" /> بازگشت</button>
                <button onClick={() => router.push('/org/work-desk')} className="trk-btn-exit"><Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {sel.createdAt && <span className="trk-chip"><span className="cap">تاریخ ثبت اولیه:</span> <b dir="ltr" style={{ unicodeBidi: 'isolate' }}>{sel.createdAt}</b></span>}
              {sel.eventDate && <span className="trk-chip"><span className="cap">تاریخ وقوع:</span> <b dir="ltr" style={{ unicodeBidi: 'isolate' }}>{sel.eventDate}</b></span>}
            </div>
          </div>

          {/* Info cards */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {info.filter(([, v]) => v).map(([l, v]) => (
              <div key={l} className="trk-info">
                <span className="ico"><Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6" /></span>
                <div className="min-w-0"><div className="lbl">{l}</div><div className="val" style={{ wordBreak: 'break-word' }}>{v}</div></div>
              </div>
            ))}
          </div>

          {/* Documents panel (filtered by claim kind) */}
          <div className="trk-panel">
            <div className="trk-panel-head">
              <span>مدارک مورد نیاز — {CLAIM_TYPE_LABELS[sel.claimType] || sel.claimType}</span>
              {checklist && <span className="trk-chip">{checklist.complete ? 'تکمیل شده' : 'ناقص'}</span>}
            </div>
            {!checklist || (checklist.items.length === 0 && (checklist.otherDocuments?.length ?? 0) === 0) ? (
              <div className="text-sm text-center py-5" style={{ color: 'var(--muted)' }}>برای این نوع پرونده مدرکی تعریف نشده است. (فرم‌های اختصاصی بعداً افزوده می‌شوند.)</div>
            ) : (
              <>
                {checklist.items.map((it) => {
                  const d = it.documents[0];
                  return (
                    <div key={it.code} className="trk-doc">
                      <span className="lbl">{it.label}</span>
                      {d?.reviews?.map((rv) => (
                        <span key={rv.stage} className="trk-stage" title={STAGE_FA[rv.stage]}>
                          <span className="dot" style={{ background: rv.state === 'APPROVED' ? '#00A859' : rv.state === 'REJECTED' ? '#FF0004' : '#E5E5E5' }} />
                          {STAGE_FA[rv.stage] || rv.stage}
                        </span>
                      ))}
                      {it.uploaded
                        ? <span className={d && d.status === 'VERIFIED' ? 'trk-done' : d && d.status === 'REJECTED' ? 'trk-rej' : 'trk-wait'}>{d?.status === 'VERIFIED' ? 'تکمیل شده' : d?.status === 'REJECTED' ? 'رد' : 'در انتظار'}</span>
                        : <span style={{ color: '#888' }}>بارگذاری‌نشده</span>}
                      {it.uploaded && d && <button onClick={() => viewDoc(d.id)} className="trk-ico-btn" title="مشاهده"><Icon path={EYE} /></button>}
                    </div>
                  );
                })}
                {(checklist.otherDocuments ?? []).map((d) => (
                  <div key={d.id} className="trk-doc">
                    <span className="lbl">{d.fileName}</span>
                    <span className={d.status === 'VERIFIED' ? 'trk-done' : d.status === 'REJECTED' ? 'trk-rej' : 'trk-wait'}>{d.statusLabel}</span>
                    <button onClick={() => viewDoc(d.id)} className="trk-ico-btn" title="مشاهده"><Icon path={EYE} /></button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Status history */}
          <div className="trk-panel">
            <div className="trk-panel-head">تاریخچه وضعیت پرونده</div>
            <div>
              {(sel.steps || []).map((s, i) => (
                <div key={i} className="trk-doc">
                  <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 26, height: 26, background: s.state === 'PENDING' ? '#FF9500' : s.state === 'APPROVED' ? '#00A859' : '#E5E5E5', color: '#fff', fontSize: 12, fontWeight: 700 }}>{s.order}</span>
                  <span className="lbl">{STEP_PARTY[s.partyType] || s.partyType}{s.holderName ? ` — ${s.holderName}` : ''}{s.branchName ? ` (${s.branchName})` : ''}</span>
                  {s.decidedAt && <span style={{ color: '#888', fontSize: '.78rem' }} dir="ltr">{s.decidedAt}</span>}
                </div>
              ))}
              {(sel.steps || []).length === 0 && <div className="text-sm text-center py-3" style={{ color: 'var(--muted)' }}>سابقه‌ای ثبت نشده است.</div>}
            </div>
          </div>
        </div>
      ) : results ? (
        /* ── Search results ── */
        <div className="pcard overflow-hidden">
          <div className="p-4 border-b font-extrabold" style={{ borderColor: 'var(--border)' }}>نتایج ({results.length.toLocaleString('fa-IR')})</div>
          {results.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>پرونده‌ای یافت نشد.</div>
          ) : (
            <table className="table">
              <thead><tr>{['شماره پرونده', 'نوع', 'بیمه‌شده (متوفی)', 'بیمه‌گر', 'وضعیت', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => open(r.id)}>
                    <td className="font-semibold">{r.claimNumber}</td>
                    <td><ClaimTypeBadge type={r.claimType} /></td>
                    <td>{r.deceasedName || '—'}</td>
                    <td>{(r.insurerTenantId && insurers[r.insurerTenantId]) || '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><button onClick={(e) => { e.stopPropagation(); open(r.id); }} className="btn btn-solid btn-sm">پیگیری</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="pcard p-10 text-center text-sm" style={{ color: 'var(--muted)' }}>برای پیگیری، کد ملی یا نام متوفی را جستجو کنید.</div>
      )}
    </Shell>
  );
}
