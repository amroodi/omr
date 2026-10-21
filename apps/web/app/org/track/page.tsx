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
          <button onClick={() => setSel(null)} className="btn btn-ghost btn-sm">→ بازگشت به نتایج</button>

          {/* Navy header card */}
          <div style={{ background: '#012141', borderRadius: 22, color: '#fff', padding: 'clamp(18px,3vw,28px)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-extrabold text-lg">پیگیری آخرین وضعیت پرونده خسارت</div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="font-bold text-lg">پرونده {sel.claimNumber}</span>
                  <StatusBadge status={sel.status} />
                  <ClaimTypeBadge type={sel.claimType} />
                </div>
                {sel.policyHolder?.name && <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>{sel.policyHolder.name}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {sel.createdAt && <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 14px', fontSize: '0.82rem' }}><span style={{ color: 'rgba(255,255,255,0.65)' }}>تاریخ ثبت: </span><b dir="ltr" style={{ unicodeBidi: 'isolate' }}>{sel.createdAt}</b></span>}
              {sel.eventDate && <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 14px', fontSize: '0.82rem' }}><span style={{ color: 'rgba(255,255,255,0.65)' }}>تاریخ وقوع: </span><b dir="ltr" style={{ unicodeBidi: 'isolate' }}>{sel.eventDate}</b></span>}
            </div>
          </div>

          {/* Info fields */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {info.filter(([, v]) => v).map(([l, v]) => (
              <div key={l} className="pcard p-4"><div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{l}</div><div className="font-bold" style={{ wordBreak: 'break-word' }}>{v}</div></div>
            ))}
          </div>

          {/* Documents for THIS claim kind (checklist filters by claim type) */}
          <div className="pcard p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-extrabold">مدارک مورد نیاز — {CLAIM_TYPE_LABELS[sel.claimType] || sel.claimType}</h3>
              {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}
            </div>
            {!checklist || (checklist.items.length === 0 && (checklist.otherDocuments?.length ?? 0) === 0) ? (
              <div className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>برای این نوع پرونده مدرکی تعریف نشده است. (فرم‌های اختصاصی بعداً افزوده می‌شوند.)</div>
            ) : (
              <div className="space-y-2">
                {checklist.items.map((it) => {
                  const d = it.documents.find((x) => x.status !== undefined) || it.documents[0];
                  return (
                    <div key={it.code} className="flex items-center justify-between gap-2 py-2 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
                      <span className="flex items-center gap-2 min-w-0"><span style={{ color: it.uploaded ? 'var(--success)' : 'var(--muted)' }}>{it.uploaded ? '✔' : '○'}</span><span className="truncate">{it.label}</span></span>
                      <span className="flex items-center gap-2 shrink-0">
                        {it.uploaded && d && <span className={`badge ${DOC_BADGE[d.status] || 'badge-neutral'}`}>{d.statusLabel}</span>}
                        {it.uploaded && d && <button onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm">مشاهده</button>}
                      </span>
                    </div>
                  );
                })}
                {(checklist.otherDocuments ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 py-2 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
                    <span className="flex items-center gap-2 min-w-0"><span style={{ color: 'var(--success)' }}>✔</span><span className="truncate">{d.fileName}</span></span>
                    <span className="flex items-center gap-2 shrink-0"><span className={`badge ${DOC_BADGE[d.status] || 'badge-neutral'}`}>{d.statusLabel}</span><button onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm">مشاهده</button></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status history */}
          <div className="pcard p-5">
            <h3 className="font-extrabold mb-3">تاریخچه وضعیت پرونده</h3>
            <div className="space-y-3">
              {(sel.steps || []).map((s, i) => {
                const active = s.state === 'PENDING';
                return (
                  <div key={i} className="flex gap-2.5 text-sm">
                    <span className="flex items-center justify-center rounded-full shrink-0 mt-0.5" style={{ width: 24, height: 24, background: active ? 'var(--brand)' : s.state === 'APPROVED' ? 'var(--success)' : 'var(--surface-2)', color: active || s.state === 'APPROVED' ? '#fff' : 'var(--muted)', fontSize: 11 }}>{s.order}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold">{STEP_PARTY[s.partyType] || s.partyType}</span>
                      {s.holderName && <span style={{ color: 'var(--muted)' }}> — {s.holderName}{s.branchName ? ` (${s.branchName})` : ''}</span>}
                      {s.decidedByName && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>اقدام‌کننده: {s.decidedByName}{s.decidedAt ? ` — ${s.decidedAt}` : ''}</div>}
                    </div>
                  </div>
                );
              })}
              {(sel.steps || []).length === 0 && <div className="text-sm text-center py-2" style={{ color: 'var(--muted)' }}>سابقه‌ای ثبت نشده است.</div>}
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
