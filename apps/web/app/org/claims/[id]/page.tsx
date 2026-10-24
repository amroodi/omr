'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../../lib/client';
import { Shell, Icon } from '../../../components/Shell';
import { ClaimTypeBadge, CLAIM_TYPE_LABELS, ErrorBox, FancyLoader, ReviewButtons, StatusBadge } from '../../../components/ui';
import Link from 'next/link';
import { ORG_NAV } from '../../nav';
import { FieldsSection } from './fields-section';
import { Workflow, WorkflowPanel, WorkflowTimeline, TimelineStep } from '../../../components/WorkflowPanel';
import { caseRef, caseTitle } from '../../../../lib/caseTitle';

interface DocReview { stage: string; state: string; canEdit: boolean }
interface ClaimDoc { id: string; fileName: string; status: string; statusLabel: string; note: string | null; uploadedAt: string | null; version: number; isLatest: boolean; reviews?: DocReview[] }
interface ChecklistItem { code: string; label: string; uploaded: boolean; latestStatus: string | null; documents: ClaimDoc[] }
interface Checklist { claimType: string; complete: boolean; items: ChecklistItem[] }

const DOC_BADGE: Record<string, string> = { PENDING: 'badge-warning', VERIFIED: 'badge-success', REJECTED: 'badge-danger', NEEDS_INFO: 'badge-warning' };
interface StepPerson { name: string | null; phone: string | null; nationalCode: string | null }
interface Step { order: number; partyType: string; state: string; holderName?: string | null; holderKind?: string | null; branchName?: string | null; levelName?: string | null; decidedByName?: string | null; decidedAt?: string | null; person?: StepPerson | null }
interface Claim {
  id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; deceasedName: string | null;
  claimedAmount: string; estimatedAmount?: string; finalizedAmount?: string | null; payableAmount?: string;
  eventDate: string | null; noticeDeadline: string | null; lateNotice: boolean;
  deceasedBirthDate?: string | null; deceasedAge?: number | null;
  policyholderCompany?: { name: string; phone: string | null } | null;
  description?: string | null;
  policyHolder?: { name: string | null; nationalCode: string | null } | null;
  insurer?: { name: string } | null;
  broker?: { name: string } | null;
  sellingBranchName?: string | null;
  handlingBranchName?: string | null;
  steps?: (Step & TimelineStep)[];
  deficiencies?: { items: string[]; resolvedAt: string | null }[];
  workflow?: Workflow;
}

// Icon paths
const ICON_ASSESS = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0 2 2 0 00-4 0zM9 14l2 2 4-4';
const ICON_USER = 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z';
const ICON_BUILDING = 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1';
const ICON_SHIELD = 'M12 2.5l7 3v5.5c0 4.2-2.9 7.7-7 8.9-4.1-1.2-7-4.7-7-8.9V5.5l7-3z';
const ICON_DOCS = 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6';
const ICON_ROUTE = 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a4 4 0 014-4h4M18 9v6a4 4 0 01-4 4h-4';

/** Green when uploaded and not rejected; red when missing or rejected (needs a replacement). */
function docState(it: { uploaded: boolean; latestStatus: string | null }): { ok: boolean; text: string } {
  if (!it.uploaded) return { ok: false, text: 'بارگذاری نشده' };
  if (it.latestStatus === 'REJECTED' || it.latestStatus === 'NEEDS_INFO') return { ok: false, text: 'رد شده — نیاز به جایگزینی' };
  if (it.latestStatus === 'VERIFIED') return { ok: true, text: 'تایید شده' };
  return { ok: true, text: 'بارگذاری شده — در حال بررسی' };
}

function SecTitle({ icon, children, extra }: { icon: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="font-extrabold flex items-center gap-2"><span className="sec-ico"><Icon path={icon} /></span>{children}</h3>
      {extra}
    </div>
  );
}
const ICON_CAM = 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z';

// The three claim approval checkpoints shown beside each document.
const STAGE_LABEL: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'ستاد', COUNCIL: 'شورای فنی' };

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'info' | 'workflow' | 'docs' | 'route'>('info'); // اطلاعات ↔ گردش کار ↔ مدارک ↔ مسیر
  const [mode, setMode] = useState<'preview' | 'edit'>('preview'); // open as read-only preview; «ویرایش» switches to tabs
  const [finalAmt, setFinalAmt] = useState(''); // مبلغ خسارت قطعی (set after assessment)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const camRefs = useRef<Record<string, HTMLInputElement | null>>({}); // mobile camera capture
  // UI-gating by permission (the API enforces these independently).
  const canProcess = hasPerm('org', 'claim:process'); // مبلغ قطعی + اقدامات گردش کار
  const canFile = hasPerm('org', 'claim:file'); // بارگذاری مدرک / رفع نقص
  const canDelete = hasPerm('org', 'claim:delete'); // حذف پرونده (مدیر سازمان)

  const removeClaim = async () => {
    if (!claim) return;
    if (!window.confirm(`حذف پرونده ${claim.claimNumber}؟ پرونده به سطل بازیافت منتقل می‌شود و تا ۱۴ روز قابل بازیابی است؛ پس از آن برای همیشه حذف خواهد شد.`)) return;
    setError(''); setBusy(true);
    try { await client.del(`/claims/${id}`, 'org'); router.push('/org/claims/trash'); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  const [lateWarn, setLateWarn] = useState(true); // org's "show late-notice warning" setting
  const load = async () => {
    try {
      const [c, cl] = await Promise.all([client.get<Claim>(`/claims/${id}`, 'org'), client.get<Checklist>(`/claims/${id}/checklist`, 'org')]);
      setClaim(c); setChecklist(cl);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', 'org').then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {}); /* eslint-disable-next-line */ }, [id]);
  // Keep the finalized-amount input in sync with the loaded value.
  useEffect(() => { setFinalAmt(claim?.finalizedAmount ? String(claim.finalizedAmount) : ''); }, [claim?.finalizedAmount]);

  const act = async (fn: () => Promise<any>) => {
    setError(''); setBusy(true);
    try { await fn(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const saveFinalized = () => act(() => client.put(`/claims/${id}/finalized-amount`, { amount: finalAmt }, 'org'));

  const upload = (code: string, file: File) => act(async () => {
    const fd = new FormData(); fd.append('file', file);
    await client.postForm(`/claims/${id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'org');
  });

  const viewDoc = async (docId: string) => {
    setError('');
    try { await client.view(`/claims/${id}/documents/${docId}/file`, 'org'); } catch (e: any) { setError(e.message); }
  };

  // Set one checkpoint's approval on a document (toggling the same icon clears it back to under-review).
  const reviewDoc = (docId: string, stage: string, state: 'APPROVED' | 'REJECTED' | 'PENDING') => act(async () => {
    let note: string | undefined;
    if (state === 'REJECTED') { note = window.prompt('دلیل رد (اختیاری):') || undefined; }
    await client.post(`/claims/${id}/documents/${docId}/review`, { stage, state, note }, 'org');
  });

  const Row = ({ label, value }: { label: string; value: any }) => value ? (
    <div className="flex justify-between py-1.5 border-b text-sm" style={{ borderColor: 'var(--border)' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span><span className="font-semibold">{value}</span>
    </div>
  ) : null;

  return (
    <Shell title={claim ? caseTitle(claim) : 'پرونده خسارت'} nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده" /></div> : (
        <div className="space-y-5">
          {claim.lateNotice && lateWarn && (
            <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر انجام شده است (مهلت: {claim.noticeDeadline}).</div>
          )}

          {/* Mode switch: open as a quick read-only preview; «ویرایش» reveals the editable tabs. */}
          <div className="flex items-center justify-between gap-2 flex-wrap no-print">
            <div className="inline-flex rounded-xl p-1 text-sm" style={{ background: 'var(--surface-2)' }}>
              <button onClick={() => setMode('preview')} className={`btn btn-sm ${mode === 'preview' ? 'btn-primary' : 'btn-ghost'}`}>پیش‌نمایش</button>
              <button onClick={() => setMode('edit')} className={`btn btn-sm ${mode === 'edit' ? 'btn-primary' : 'btn-ghost'}`}>ویرایش</button>
              <Link href={`/org/claims/${id}/assess`} className="btn btn-sm btn-ghost" title="ارزیابی مدارک در صفحهٔ دوستونه"><Icon path={ICON_ASSESS} /> ارزیابی</Link>
            </div>
            {mode === 'preview' && (
              <div className="flex items-center gap-2">
                {hasPerm('org', 'export:list') && (
                  <button onClick={() => client.download(`/exports/claim/${id}.xlsx`, 'org', `claim-${claim.claimNumber}.xlsx`)} className="btn btn-ghost btn-sm" title="خروجی اکسل این پرونده"><Icon path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /> خروجی اکسل</button>
                )}
                <button onClick={() => window.print()} className="btn btn-ghost btn-sm" title="چاپ / ذخیره PDF"><Icon path="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" /> چاپ / PDF</button>
              </div>
            )}
          </div>

          {/* Header: navy hero with the key facts, then the parties as cards */}
          <div className="claim-hero">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs opacity-75">{claim.policyNumber ? 'شماره بیمه‌نامه' : 'پرونده خسارت'}</div>
                <div className="text-2xl font-extrabold leading-tight">{caseRef(claim)}</div>
                <div className="text-base font-bold mt-1">{claim.deceasedName}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <ClaimTypeBadge type={claim.claimType} />
                <StatusBadge status={claim.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {([
                [['DEATH_ILLNESS', 'DEATH_ACCIDENT'].includes(claim.claimType) ? 'تاریخ فوت' : 'تاریخ وقوع حادثه', claim.eventDate],
                ['تاریخ تولد', claim.deceasedBirthDate],
                ['سن', claim.deceasedAge != null ? `${claim.deceasedAge.toLocaleString('fa-IR')} سال` : null],
                ['مبلغ برآوردی', `${Number(claim.estimatedAmount ?? claim.claimedAmount).toLocaleString('fa-IR')} ریال`],
                ['مبلغ قطعی', claim.finalizedAmount ? `${Number(claim.finalizedAmount).toLocaleString('fa-IR')} ریال` : 'پس از ارزیابی'],
                ['مهلت اعلام', claim.noticeDeadline],
              ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([l, v]) => (
                <span key={l} className="claim-fact"><span className="cap">{l}</span><b>{v}</b></span>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {(claim.policyHolder || claim.policyholderCompany) && (
              <div className="party-card">
                <span className="party-ico"><Icon path={ICON_USER} /></span>
                <div className="min-w-0">
                  <div className="cap">بیمه‌گزار</div>
                  <div className="font-bold truncate">{claim.policyholderCompany?.name || claim.policyHolder?.name || '—'}</div>
                  {claim.policyholderCompany && claim.policyHolder?.name && <div className="sub">نماینده: {claim.policyHolder.name}</div>}
                  {claim.policyHolder?.nationalCode && <div className="sub" dir="ltr" style={{ textAlign: 'right' }}>کد ملی: {claim.policyHolder.nationalCode}</div>}
                </div>
              </div>
            )}
            {claim.broker && (
              <div className="party-card">
                <span className="party-ico"><Icon path={ICON_BUILDING} /></span>
                <div className="min-w-0">
                  <div className="cap">کارگزاری (معرف)</div>
                  <div className="font-bold truncate">{claim.broker.name}</div>
                </div>
              </div>
            )}
            {claim.insurer && (
              <div className="party-card">
                <span className="party-ico"><Icon path={ICON_SHIELD} /></span>
                <div className="min-w-0">
                  <div className="cap">بیمه‌گر</div>
                  <div className="font-bold truncate">{claim.insurer.name}</div>
                  {claim.handlingBranchName && <div className="sub">شعبهٔ رسیدگی‌کننده: {claim.handlingBranchName}</div>}
                  {claim.sellingBranchName && claim.sellingBranchName !== claim.handlingBranchName && <div className="sub">شعبه فروشنده: {claim.sellingBranchName}</div>}
                </div>
              </div>
            )}
          </div>
          {claim.description && (
            <div className="card p-4 text-sm whitespace-pre-wrap"><b>توضیحات بیمه‌گزار: </b><span style={{ color: 'var(--muted)' }}>{claim.description}</span></div>
          )}

          {/* Workflow: position in the chain + the actions the server offers this user */}
          {claim.workflow && (
            <div className="card p-4 no-print">
              <SecTitle icon={ICON_ROUTE} extra={canDelete && <button onClick={removeClaim} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} title="انتقال به سطل بازیافت (۱۴ روز قابل بازیابی)">حذف پرونده</button>}>گردش کار پرونده</SecTitle>
              <WorkflowPanel claimId={id} workflow={claim.workflow} realm="org" onDone={load} />
              {/* Finalized damage amount (مبلغ خسارت قطعی) — set by the assessing operator after review. */}
              {canProcess && !['REJECTED'].includes(claim.status) && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-sm font-semibold">مبلغ خسارت قطعی (پس از ارزیابی):</span>
                  <input className="input" style={{ maxWidth: 220, direction: 'ltr', textAlign: 'right' }} inputMode="numeric"
                    value={finalAmt ? Number(String(finalAmt).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR') : ''}
                    onChange={(e) => setFinalAmt(e.target.value.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))))}
                    placeholder="مبلغ به ریال" />
                  <button onClick={saveFinalized} disabled={busy || !finalAmt} className="btn btn-primary btn-sm">ثبت مبلغ قطعی</button>
                  {claim.finalizedAmount && <span className="badge badge-success">ثبت‌شده</span>}
                </div>
              )}

            </div>
          )}

          {/* Preview: everything read-only, at a glance */}
          {mode === 'preview' && (
            <>
              <FieldsSection claimId={id} realm="org" basePath="/claims" readOnly />
              {checklist && (
                <div className="card p-5">
                  <SecTitle icon={ICON_DOCS} extra={<span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}>مدارک مورد نیاز</SecTitle>
                  <div className="grid md:grid-cols-2 gap-2">
                    {checklist.items.map((it) => {
                      const st = docState(it);
                      return (
                        <div key={it.code} className={`doc-row ${st.ok ? 'is-ok' : 'is-bad'} flex justify-between items-center gap-2 text-sm`}>
                          <span className="font-semibold">{it.label}</span>
                          <span className="doc-state shrink-0">{st.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="card p-5">
                <SecTitle icon={ICON_ROUTE}>مسیر گردش کار</SecTitle>
                <WorkflowTimeline claimId={id} steps={claim.steps} realm="org" />
              </div>
            </>
          )}

          {mode === 'edit' && (
          <>
          {/* Tabs (full width) */}
          <div className="card p-1.5 flex gap-1.5 text-xs sm:text-sm overflow-x-auto">
            <button type="button" onClick={() => setTab('info')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'info' ? 'btn-primary' : 'btn-ghost'}`}>اطلاعات پرونده</button>
            <button type="button" onClick={() => setTab('workflow')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'workflow' ? 'btn-primary' : 'btn-ghost'}`}>مراحل و گردش کار</button>
            <button type="button" onClick={() => setTab('docs')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'docs' ? 'btn-primary' : 'btn-ghost'}`}>
              مدارک{checklist && !checklist.complete ? <span style={{ color: 'var(--warning)' }}> ●</span> : null}
            </button>
            <button type="button" onClick={() => setTab('route')} className={`flex-1 btn btn-sm whitespace-nowrap ${tab === 'route' ? 'btn-primary' : 'btn-ghost'}`}>مسیر گردش کار</button>
          </div>

          {tab === 'info' && <FieldsSection claimId={id} realm="org" basePath="/claims" groups={['CLAIM_DATA', 'BENEFICIARY']} />}
          {tab === 'workflow' && <FieldsSection claimId={id} realm="org" basePath="/claims" groups={['WORKFLOW_STAGE']} />}

          {tab === 'docs' && (
            <>
              <div className="card p-5">
                <SecTitle icon={ICON_DOCS} extra={checklist && <span className={`badge ${checklist.complete ? 'badge-success' : 'badge-warning'}`}>{checklist.complete ? 'کامل' : 'ناقص'}</span>}>مدارک مورد نیاز</SecTitle>
                <div className="space-y-2.5">
                  {checklist?.items.map((it) => { const st = docState(it); return (
                    <div key={it.code} className={`doc-row ${st.ok ? 'is-ok' : 'is-bad'}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm min-w-0">
                          <span className="font-bold">{it.label}</span>
                          <span className="doc-state mr-2">{st.text}</span>
                        </span>
                        {canFile && (
                          <div className="flex items-center gap-1.5">
                            <input ref={(el) => { fileRefs.current[it.code] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                              onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                            <input ref={(el) => { camRefs.current[it.code] = el; }} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                              onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(it.code, file); e.currentTarget.value = ''; }} />
                            <button onClick={() => camRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm sm:hidden" title="گرفتن عکس با دوربین" aria-label="دوربین"><Icon path={ICON_CAM} /></button>
                            <button onClick={() => fileRefs.current[it.code]?.click()} disabled={busy} className="btn btn-ghost btn-sm" title={it.uploaded ? 'بارگذاری نسخهٔ جایگزین' : 'بارگذاری'}><Icon path="M12 15V3m0 0L8 7m4-4l4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" /> {it.uploaded ? 'جایگزین' : 'بارگذاری'}</button>
                          </div>
                        )}
                      </div>
                      {it.documents.length > 0 && (
                        <div className="mt-2 space-y-1.5 mr-6">
                          {it.documents.map((d) => (
                            <div key={d.id} className="rounded-lg px-2 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', opacity: d.isLatest ? 1 : 0.7 }}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs flex items-center gap-2 min-w-0 flex-wrap">
                                  <span className="badge badge-neutral shrink-0">نسخه {d.version}</span>
                                  {d.isLatest && <span className="badge badge-success shrink-0">جدیدترین</span>}
                                  <span className={`badge ${DOC_BADGE[d.status] || 'badge-neutral'} shrink-0`}>{d.statusLabel}</span>
                                  <span className="truncate" style={{ color: 'var(--muted)' }}>{d.uploadedAt}</span>
                                </span>
                                <button onClick={() => viewDoc(d.id)} className="btn btn-ghost btn-sm shrink-0">مشاهده</button>
                              </div>
                              {d.reviews && d.reviews.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border)' }}>
                                  {d.reviews.map((rv) => {
                                    const editable = rv.canEdit && d.isLatest && !['PAID', 'REJECTED'].includes(claim.status);
                                    return (
                                      <span key={rv.stage} className="flex items-center gap-1.5">
                                        <span className="font-semibold" style={{ color: 'var(--muted)' }}>{STAGE_LABEL[rv.stage] || rv.stage}:</span>
                                        <ReviewButtons state={rv.state} editable={editable} busy={busy} label={STAGE_LABEL[rv.stage]} onSet={(st) => reviewDoc(d.id, rv.stage, st)} />
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ); })}
                </div>
              </div>

              {claim.deficiencies && claim.deficiencies.length > 0 && (
                <div className="card p-5">
                  <h3 className="font-bold mb-2">سوابق نقص مدارک</h3>
                  {claim.deficiencies.map((d, i) => (
                    <div key={i} className="text-sm mb-2">
                      <span className={`badge ${d.resolvedAt ? 'badge-success' : 'badge-danger'}`}>{d.resolvedAt ? 'رفع شد' : 'باز'}</span>
                      <ul className="mt-1 mr-4 list-disc" style={{ color: 'var(--muted)' }}>{(d.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'route' && (
            <div className="card p-5">
              <h3 className="font-bold mb-3">مسیر گردش کار</h3>
              <WorkflowTimeline claimId={id} steps={claim.steps} realm="org" />
            </div>
          )}
          </>
          )}
        </div>
      )}
    </Shell>
  );
}
