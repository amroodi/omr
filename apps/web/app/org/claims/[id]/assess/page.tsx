'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../../../lib/client';
import { Shell, Icon } from '../../../../components/Shell';
import { ClaimTypeBadge, CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, StatusBadge } from '../../../../components/ui';
import { ORG_NAV } from '../../../nav';

interface DocReview { stage: string; state: string; canEdit: boolean }
interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; version: number; isLatest: boolean; reviews?: DocReview[] }
interface ChecklistItem { code: string; label: string; uploaded: boolean; documents: ClaimDoc[] }
interface Checklist { complete: boolean; items: ChecklistItem[]; otherDocuments?: ClaimDoc[] }
interface DocMeta { id: string; docCode: string | null; fileName: string; mimeType: string }
interface Claim {
  id: string; claimNumber: string; status: string; claimType: string; deceasedName: string | null;
  estimatedAmount?: string; claimedAmount: string; finalizedAmount?: string | null;
  eventDate: string | null; policyHolder?: { name: string | null; nationalCode: string | null } | null;
  insurer?: { name: string } | null; broker?: { name: string } | null; sellingBranchName?: string | null;
}

const STAGE_LABEL: Record<string, string> = { BROKER: 'معرف (کارگزاری)', BRANCH: 'شعبه', COUNCIL: 'ستاد (شورای فنی)' };
const ICON_CHECK = 'M20 6L9 17l-5-5';
const ICON_X = 'M6 18L18 6M6 6l12 12';

/** One document rendered inline (image scaled by zoom, or PDF in an embed). */
function DocMedia({ claimId, docId, fileName, zoom }: { claimId: string; docId: string; fileName: string; zoom: number }) {
  const [src, setSrc] = useState<{ url: string; mimeType: string } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let active = true; let u: string | null = null;
    client.blobUrl(`/claims/${claimId}/documents/${docId}/file`, 'org')
      .then((r) => { if (active) { setSrc(r); u = r.url; } else URL.revokeObjectURL(r.url); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; if (u) URL.revokeObjectURL(u); };
  }, [claimId, docId]);
  if (err) return <div className="text-xs py-4 text-center" style={{ color: 'var(--danger)' }}>خطا در بارگذاری سند</div>;
  if (!src) return <div className="py-8 flex justify-center"><span className="pspinner" /></div>;
  if (src.mimeType === 'application/pdf') return <iframe className="assess-doc-pdf" src={src.url} title={fileName} />;
  return <div className="assess-doc-media"><img className="assess-doc-img" style={{ width: `${zoom}%` }} src={src.url} alt={fileName} /></div>;
}

export default function AssessClaim() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [finalAmt, setFinalAmt] = useState('');
  const [showDef, setShowDef] = useState(false);
  const [defText, setDefText] = useState('');
  const canProcess = hasPerm('org', 'claim:process');

  const load = async () => {
    try {
      const [c, cl, dl] = await Promise.all([
        client.get<Claim>(`/claims/${id}`, 'org'),
        client.get<Checklist>(`/claims/${id}/checklist`, 'org'),
        client.get<DocMeta[]>(`/claims/${id}/documents`, 'org'),
      ]);
      setClaim(c); setChecklist(cl); setDocs(dl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { setFinalAmt(claim?.finalizedAmount ? String(claim.finalizedAmount) : ''); }, [claim?.finalizedAmount]);

  const act = async (fn: () => Promise<any>) => { setError(''); setBusy(true); try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const reviewDoc = (docId: string, stage: string, state: 'APPROVED' | 'REJECTED' | 'PENDING') => act(async () => {
    let note: string | undefined;
    if (state === 'REJECTED') note = window.prompt('دلیل رد (اختیاری):') || undefined;
    await client.post(`/claims/${id}/documents/${docId}/review`, { stage, state, note }, 'org');
  });
  const saveFinalized = () => act(() => client.put(`/claims/${id}/finalized-amount`, { amount: finalAmt }, 'org'));
  const endorse = () => act(() => client.post(`/claims/${id}/endorse`, {}, 'org'));
  const reject = () => act(() => client.post(`/claims/${id}/reject`, { note: 'رد پرونده در ارزیابی' }, 'org'));
  const returnIncomplete = () => act(async () => {
    const deficiencies = defText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (deficiencies.length === 0) throw new Error('حداقل یک مورد نقص را وارد کنید');
    await client.post(`/claims/${id}/return-incomplete`, { deficiencies }, 'org');
    setShowDef(false); setDefText('');
  });

  // The checkpoint(s) this operator may actually set (from the docs' canEdit flags).
  const myStages = useMemo(() => {
    const s = new Set<string>();
    checklist?.items.forEach((it) => it.documents.forEach((d) => d.reviews?.forEach((r) => { if (r.canEdit) s.add(r.stage); })));
    return [...s];
  }, [checklist]);
  const myStageLabel = myStages.map((s) => STAGE_LABEL[s]).join('، ');

  // Every uploaded document to review — required docs (latest per item) + any other uploads.
  const reviewDocs = useMemo(() => {
    const out: { label: string; d: ClaimDoc }[] = [];
    checklist?.items.forEach((it) => { const d = it.documents.find((x) => x.isLatest) || it.documents[0]; if (d) out.push({ label: it.label, d }); });
    checklist?.otherDocuments?.filter((d) => d.isLatest).forEach((d) => out.push({ label: d.fileName, d }));
    return out;
  }, [checklist]);

  // Bulk-approve every latest document at the operator's stage.
  const approveAllMyStage = () => act(async () => {
    const stage = myStages[0]; if (!stage) return;
    for (const { d } of reviewDocs) await client.post(`/claims/${id}/documents/${d.id}/review`, { stage, state: 'APPROVED' }, 'org');
  });

  const amt = (v?: string | null) => (v ? `${Number(v).toLocaleString('fa-IR')} ریال` : null);
  const closed = claim ? ['PAID', 'REJECTED'].includes(claim.status) : false;

  return (
    <Shell title={claim ? `ارزیابی پرونده ${claim.claimNumber}` : 'ارزیابی پرونده'} breadcrumb="ارزیابی پرونده" nav={ORG_NAV} realm="org"
      action={<button onClick={() => router.push('/org/work-desk')} className="btn btn-ghost btn-sm">بستن ✕</button>}>
      <ErrorBox message={error} />
      {!claim ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده…" /></div> : (
        <div className="assess-split">
          {/* RIGHT (first in RTL): evaluation form */}
          <div className="assess-pane">
            <div className="assess-form-inner space-y-4">
              {/* Claim summary */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <ClaimTypeBadge type={claim.claimType} />
                  <StatusBadge status={claim.status} />
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌شده (متوفی)</span><span className="font-semibold">{claim.deceasedName || '—'}</span></div>
                  {claim.policyHolder?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌گزار</span><span className="font-semibold">{claim.policyHolder.name}</span></div>}
                  {claim.broker?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>معرف</span><span className="font-semibold">{claim.broker.name}</span></div>}
                  {claim.insurer?.name && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>بیمه‌گر</span><span className="font-semibold">{claim.insurer.name}{claim.sellingBranchName ? ` — ${claim.sellingBranchName}` : ''}</span></div>}
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>مبلغ برآوردی</span><span className="font-semibold">{amt(claim.estimatedAmount ?? claim.claimedAmount)}</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>مبلغ قطعی</span><span className="font-semibold" style={{ color: claim.finalizedAmount ? 'var(--success)' : 'var(--muted)' }}>{amt(claim.finalizedAmount) || '— پس از ارزیابی'}</span></div>
                  {claim.eventDate && <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>تاریخ وقوع</span><span className="font-semibold">{claim.eventDate}</span></div>}
                </div>
              </div>

              {/* Document review (3-stage) */}
              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-extrabold text-sm">بررسی و تایید مدارک</h3>
                  {checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'مدارک کامل' : 'مدارک ناقص'}</span>}
                </div>
                <div className="space-y-2">
                  {reviewDocs.map(({ label, d }) => (
                    <div key={d.id} className="rounded-xl p-2.5" style={{ background: 'var(--surface-2)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate">{label}</span>
                        <button onClick={() => document.getElementById(`doc-${d.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="btn btn-ghost btn-sm shrink-0" title="نمایش در تصویر">نمایش سند</button>
                      </div>
                      {d.reviews && d.reviews.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs">
                          {d.reviews.map((rv) => {
                            const editable = rv.canEdit && d.isLatest && !closed;
                            return (
                              <span key={rv.stage} className="flex items-center gap-1">
                                <span style={{ color: 'var(--muted)' }}>{STAGE_LABEL[rv.stage] || rv.stage}:</span>
                                {editable ? (
                                  <>
                                    <button onClick={() => reviewDoc(d.id, rv.stage, rv.state === 'APPROVED' ? 'PENDING' : 'APPROVED')} disabled={busy} title="تایید" className="inline-flex p-0.5" style={{ color: rv.state === 'APPROVED' ? 'var(--success)' : 'var(--muted)' }}><Icon path={ICON_CHECK} /></button>
                                    <button onClick={() => reviewDoc(d.id, rv.stage, rv.state === 'REJECTED' ? 'PENDING' : 'REJECTED')} disabled={busy} title="رد" className="inline-flex p-0.5" style={{ color: rv.state === 'REJECTED' ? 'var(--danger)' : 'var(--muted)' }}><Icon path={ICON_X} /></button>
                                  </>
                                ) : (
                                  <span style={{ color: rv.state === 'APPROVED' ? 'var(--success)' : rv.state === 'REJECTED' ? 'var(--danger)' : 'var(--warning)', fontWeight: 700 }}>{rv.state === 'APPROVED' ? '✓' : rv.state === 'REJECTED' ? '✕' : '●'}</span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                  {reviewDocs.length === 0 && (
                    <div className="text-xs text-center py-3" style={{ color: 'var(--muted)' }}>مدرکی بارگذاری نشده است.</div>
                  )}
                </div>
                {myStages.length > 0 && !closed && (
                  <button onClick={approveAllMyStage} disabled={busy} className="btn btn-solid btn-sm w-full mt-3">تایید همهٔ مدارک در مرحلهٔ {myStageLabel}</button>
                )}
              </div>

              {/* Finalized amount */}
              {canProcess && !closed && (
                <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <label className="label">مبلغ خسارت قطعی (پس از ارزیابی)</label>
                  <div className="flex items-center gap-2">
                    <input className="input" style={{ direction: 'ltr', textAlign: 'right' }} inputMode="numeric"
                      value={finalAmt ? Number(String(finalAmt).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR') : ''}
                      onChange={(e) => setFinalAmt(e.target.value.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))))}
                      placeholder="مبلغ به ریال" />
                    <button onClick={saveFinalized} disabled={busy || !finalAmt} className="btn btn-primary btn-sm shrink-0">ثبت</button>
                  </div>
                </div>
              )}

              {/* Decisions */}
              {canProcess && !closed && (
                <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={endorse} disabled={busy} className="btn btn-solid btn-sm">تایید و ارسال</button>
                    <button onClick={() => setShowDef(!showDef)} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--warning)' }}>اعلام نقص / عودت</button>
                    <button onClick={reject} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>رد پرونده</button>
                  </div>
                  {showDef && (
                    <div className="space-y-2">
                      <textarea value={defText} onChange={(e) => setDefText(e.target.value)} placeholder="هر مورد نقص در یک خط" className="input" rows={3} />
                      <button onClick={returnIncomplete} disabled={busy} className="btn btn-sm" style={{ background: 'var(--warning)', color: '#fff' }}>ارسال نقص مدارک به بیمه‌گزار</button>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-3 flex gap-2" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => router.push(`/org/claims/${id}`)} className="btn btn-ghost btn-sm">مشاهدهٔ کامل پرونده</button>
                <button onClick={() => router.push('/org/work-desk')} className="btn btn-ghost btn-sm mr-auto">بعداً بررسی می‌کنم</button>
              </div>
            </div>
          </div>

          {/* LEFT: documents viewer (scrolls independently) */}
          <div className="assess-pane assess-docs">
            <div className="assess-toolbar">
              <span>اسناد بارگذاری‌شده ({docs.length.toLocaleString('fa-IR')})</span>
              <span className="mr-auto flex items-center gap-1.5">
                <button className="zbtn" onClick={() => setZoom((z) => Math.max(40, z - 15))} title="کوچک‌تر">−</button>
                <span style={{ minWidth: 44, textAlign: 'center' }}>{zoom.toLocaleString('fa-IR')}٪</span>
                <button className="zbtn" onClick={() => setZoom((z) => Math.min(250, z + 15))} title="بزرگ‌تر">+</button>
              </span>
            </div>
            {docs.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>سندی بارگذاری نشده است.</div>
            ) : docs.map((d) => (
              <div key={d.id} id={`doc-${d.id}`} className="assess-doc">
                <div className="assess-doc-head">
                  <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>{d.fileName}</span>
                  <button onClick={() => client.view(`/claims/${id}/documents/${d.id}/file`, 'org')} className="btn btn-ghost btn-sm shrink-0">باز کردن</button>
                </div>
                <DocMedia claimId={id} docId={d.id} fileName={d.fileName} zoom={zoom} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
