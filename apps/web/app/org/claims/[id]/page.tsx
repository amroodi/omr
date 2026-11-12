'use client';
import { DeathNoticeDate } from '../../../components/DeathNoticeDate';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm, orgMode } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../components/ui';
import { ORG_NAV } from '../../nav';
import { WorkflowPanel, WorkflowTimeline } from '../../../components/WorkflowPanel';
import { caseTitle } from '../../../../lib/caseTitle';
import { ArchivedNotice, CaseSummary, ClaimDoc, DEATH_TYPES, STATUS_FA, useCase } from '../../../components/case-ui';
import { filerText, INSURED_RELATIONS, personTitle } from '../../../components/claim-wording';
import { CaseEditForm } from './case-edit';
import { HeirsCard } from '../../../components/heirs';
import { PaymentBox, PaymentInfo } from '../../../components/PaymentBox';
import { PolicyholderCase } from '../../../components/PolicyholderCase';
import { DeficiencyBox } from '../../../components/DeficiencyBox';

/**
 * «مشاهده»: the case on one page, laid out like Sinad's case window — a title bar with the case's own
 * buttons, the grey strip of key facts, where the case stands on its chain, the «نقص مدارک» box when a
 * return is open, the actions this user can take right now, then tabs (مشخصات / مدارک / گردش کار /
 * ذینفعان / سوابق نقص). «ویرایش» corrects the case's data; «ارزیابی» opens the evaluation window.
 */
/** Panel 1 (an organization's staff filing cases) sees the case as the بیمه‌گزار does; panel 2 assesses it. */
export default function ClaimPage() {
  const [entry, setEntry] = useState<boolean | null>(null);
  useEffect(() => { setEntry(orgMode() === 'ENTRY'); }, []);
  if (entry === null) return null;
  return entry ? <PolicyholderCase realm="org" /> : <ClaimDetail />;
}

const DESK_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'ستاد', COUNCIL: 'شورای فنی' };
const rial = (v?: string | null) => (v != null && v !== '' ? `${Number(v).toLocaleString('fa-IR')} ریال` : '—');
type Tab = 'info' | 'docs' | 'flow' | 'heirs' | 'defs';
const openDefsAny = (c: { deficiencies?: { resolvedAt: string | null }[] } | null) => !!c?.deficiencies?.some((d) => !d.resolvedAt);

function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { claim, fv, checklist, error, setError, reload } = useCase(id);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [tab, setTab] = useState<Tab>('info');
  const [perms, setPerms] = useState({ del: false, exp: false, file: false, process: false });
  useEffect(() => { setPerms({ del: hasPerm('org', 'claim:delete'), exp: hasPerm('org', 'export:list'), file: hasPerm('org', 'claim:file'), process: hasPerm('org', 'claim:process') }); }, []);
  const [lateWarn, setLateWarn] = useState(true); // org's "show late-notice warning" setting
  useEffect(() => { client.get<{ lateNoticeWarning?: boolean }>('/tenant/branding', 'org').then((b) => setLateWarn(b.lateNoticeWarning !== false)).catch(() => {}); }, []);

  const removeClaim = async () => {
    if (!claim) return;
    if (!window.confirm(`حذف ${caseTitle(claim)}؟ پرونده به سطل بازیافت منتقل می‌شود و تا ۱۴ روز قابل بازیابی است؛ پس از آن برای همیشه حذف خواهد شد.`)) return;
    setError(''); setBusy(true);
    try { await client.del(`/claims/${id}`, 'org'); router.push('/org/claims/trash'); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  const name = claim ? (claim.deceasedName || fv.full_name || '—') : '';
  const isDeath = !!claim && (claim.claimTypeDeath ?? DEATH_TYPES.has(claim.claimType));
  const editTitle = claim && name !== '—' ? personTitle(name, { death: isDeath, gender: claim.insuredGender }) : name;
  const w = claim?.workflow;
  const closed = claim?.status === 'PAID' || claim?.status === 'REJECTED';
  const docRows = [
    ...(checklist?.items ?? []).map((it) => ({ key: it.code, label: it.label, required: !!it.required, doc: it.documents[0] as ClaimDoc | undefined, extras: it.extras ?? [], def: it.deficiency })),
    ...(checklist?.otherDocuments ?? []).filter((d) => d.isLatest).map((d) => ({ key: d.id, label: `سایر مدارک — ${d.fileName}`, required: false, doc: d as ClaimDoc | undefined, extras: [] as ClaimDoc[], def: undefined })),
  ];
  const desks = ['BROKER', 'BRANCH', 'HQ', 'COUNCIL'].filter((s) => docRows.some((r) => r.doc?.reviews?.some((x) => x.stage === s)));
  const uploadedCount = docRows.filter((r) => r.doc).length;
  const openDefs = (claim?.deficiencies ?? []).filter((d) => !d.resolvedAt).length;
  const deficiencyMove = w?.direction === 'DOWN' && w.purpose === 'DEFICIENCY' && openDefsAny(claim); // the «نقص مدارک» box carries these buttons
  const myActions = !w?.holdsDesk ? [] : deficiencyMove ? w.actions.filter((a) => !['FIX_HERE', 'DOWN_FORWARD', 'DOWN_DIRECT'].includes(a.key)) : w.actions;
  const phaseLabel = !w?.currentStage ? (claim ? STATUS_FA[claim.status] ?? claim.status : '')
    : w.purpose === 'PAYMENT' ? 'در مسیر پرداخت' : w.direction === 'DOWN' ? 'عودت‌شده برای رفع نقص' : 'در حال بررسی';

  return (
    <Shell title={claim ? caseTitle(claim) : 'پرونده خسارت'} nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده" /></div> : (
        <div className="cv">
          {/* ── Title bar: the case and its own buttons ── */}
          <div className="cv-title">
            <span className="cv-title-main">پرونده {caseTitle(claim)}<span className="cv-title-sub">{name}</span></span>
            <span className={`cv-status is-${claim.status.toLowerCase()}`}>{STATUS_FA[claim.status] ?? claim.status}</span>
            <span className="cv-title-btns no-print">
              <button className={`cv-tbtn${mode === 'preview' ? ' is-on' : ''}`} onClick={() => setMode('preview')}>مشاهده</button>
              {claim.status !== 'PAID' && <button className={`cv-tbtn${mode === 'edit' ? ' is-on' : ''}`} onClick={() => setMode('edit')}>ویرایش</button>}
              <Link href={`/org/claims/${id}/evaluate`} className="cv-tbtn is-strong">ارزیابی</Link>
              <Link href={`/org/claims/${id}/documents`} className="cv-tbtn">مدارک</Link>
              <a href={`/org/reminders?claim=${id}&n=${encodeURIComponent(claim.claimNumber)}`} target="_blank" rel="noopener" className="cv-tbtn" title="یادآوری پیگیری این پرونده برای خودتان یا همکار">یادآور</a>
              {perms.exp && <button className="cv-tbtn" onClick={() => client.download(`/exports/claim/${id}.xlsx`, 'org', `claim-${claim.policyNumber || claim.claimNumber}.xlsx`)}>اکسل</button>}
              {perms.del && claim.status !== 'PAID' && <button className="cv-tbtn is-danger" onClick={removeClaim} disabled={busy} title="انتقال به سطل بازیافت (۱۴ روز قابل بازیابی)">حذف</button>}
            </span>
          </div>

          {/* ── Grey strip: the facts an operator looks for first ── */}
          <div className="ev-strip cv-strip">
            <div><span>بیمه‌گزار:</span><b>{claim.policyholderCompany?.name || fv.company_name || '—'}</b></div>
            <div><span>بیمه‌نامه:</span><b className="ltr">{claim.policyNumber || fv.policy_number || '—'}</b>{claim.lineLabel && <span>({claim.lineLabel})</span>}</div>
            <div><span>بیمه‌شده:</span><b>{editTitle}</b></div>
            <div><span>کد ملی:</span><b className="ltr">{claim.deceasedNationalCode || fv.national_code || '—'}</b></div>
            <div><span>نسبت:</span><b>{claim.insuredRelation ? INSURED_RELATIONS[claim.insuredRelation] ?? claim.insuredRelation : 'اصلی'}{claim.mainInsuredName && claim.insuredRelation && claim.insuredRelation !== 'MAIN' ? ` (${claim.mainInsuredName})` : ''}</b></div>
            <div><span>نوع پرونده:</span><b>{claim.claimTypeLabel || claim.claimType}</b></div>
            <div><span>{isDeath ? 'تاریخ فوت' : 'تاریخ حادثه'}:</span><b>{claim.eventDate || '—'}</b></div>
            {!claim.imported && claim.createdAt && <div><span>تاریخ ثبت:</span><b>{claim.createdAt.split(' ')[0]}</b></div>}
            <div><span>مبلغ برآوردی:</span><b>{Number(claim.estimatedAmount ?? claim.claimedAmount) > 0 ? rial(claim.estimatedAmount ?? claim.claimedAmount) : 'ثبت نشده'}</b></div>
            <div><span>مبلغ قطعی:</span><b style={{ color: claim.finalizedAmount ? '#0f7a55' : '#c0172f' }}>{claim.finalizedAmount ? rial(claim.finalizedAmount) : 'ثبت نشده'}</b></div>
            {claim.handlingBranchName && <div><span>شعبه:</span><b>{claim.handlingBranchName}</b></div>}
            {claim.broker?.name && <div><span>کارگزاری:</span><b>{claim.broker.name}</b></div>}
            {claim.filedBy && <div><span>ثبت‌کننده:</span><b>{filerText(claim.filedBy)}</b></div>}
            {claim.lateNotice && lateWarn && <div className="ev-strip-red">اعلام خسارت خارج از مهلت مقرر انجام شده است (مهلت: {claim.noticeDeadline})</div>}
          </div>

          {claim.status === 'PAID' && <ArchivedNotice />}

          {mode === 'edit' && claim.status !== 'PAID' ? (
            <CaseEditForm claimId={id} title={editTitle} onSaved={() => { reload(); setMode('preview'); }} />
          ) : (
            <>
              {/* ── Where the case is ── */}
              {w && !claim.story?.manual && (
                <div className="cv-chain">
                  {w.chain.map((c, i) => {
                    const cur = w.chain.findIndex((x) => x.stage === w.currentStage);
                    const here = c.stage === w.currentStage;
                    const passed = cur >= 0 && i < cur;
                    return (
                      <div key={c.stage} className={`cv-step${here ? ' is-here' : passed ? ' is-passed' : ''}${here && w.direction === 'DOWN' ? ' is-back' : ''}`}>
                        <span className="cv-step-n">{(i + 1).toLocaleString('fa-IR')}</span>
                        <span className="cv-step-l">{c.label}{c.stage === w.myStage ? ' (شما)' : ''}</span>
                        {here && <span className="cv-step-s">{phaseLabel}</span>}
                      </div>
                    );
                  })}
                  {!w.currentStage && <div className="cv-step is-closed"><span className="cv-step-l">{STATUS_FA[claim.status]}</span></div>}
                </div>
              )}

              {/* ── نقص مدارک: what was asked, upload slots, and the fix / send-down buttons ── */}
              <DeathNoticeDate claimId={id} />
              <DeficiencyBox claimId={id} claim={claim} checklist={checklist} realm="org" canUpload={!closed && (perms.file || (perms.process && !!w?.holdsDesk))} onChanged={reload} />

              {/* ── What this user can do now ── */}
              {w && !closed && !(deficiencyMove && w.holdsDesk && !myActions.length) && (
                <div className={`cv-act${myActions.length ? ' is-mine' : ''}`}>
                  <div className="cv-act-h">{myActions.length ? 'اقدام شما روی این پرونده' : 'اقدام'}</div>
                  {myActions.length ? (
                    <WorkflowPanel claimId={id} workflow={{ ...w, actions: myActions }} realm="org" onDone={reload} actionsOnly />
                  ) : (
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>پرونده اکنون نزد «{w.currentStageLabel ?? '—'}» است؛ اقدامی برای شما در این مرحله نیست.</div>
                  )}
                </div>
              )}

              {/* ── Tabs ── */}
              <div className="ev-tabs cv-tabs no-print">
                {([['info', 'مشخصات پرونده'], ['docs', `مدارک (${uploadedCount.toLocaleString('fa-IR')} از ${docRows.length.toLocaleString('fa-IR')})`], ['heirs', 'ذینفعان'], ['flow', 'گردش کار'], ['defs', `سوابق نقص${openDefs ? ` (${openDefs.toLocaleString('fa-IR')} باز)` : ''}`]] as [Tab, string][]).map(([k, l]) => (
                  <button key={k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <div className="cv-pane">
                {tab === 'info' && (
                  <div className="space-y-3">
                    <CaseSummary claim={claim} fv={fv} />
                    {claim.coverageStatus && <div className={claim.coverageStatus === 'VALID' ? 'alert-success' : 'alert-error'}>استعلام پوشش: {({ VALID: 'معتبر', INVALID: 'نامعتبر', NOT_FOUND: 'یافت نشد', NOT_CHECKED: 'بررسی‌نشده؛ به‌محض در دسترس بودن سامانهٔ بیمه‌گر خودکار بررسی می‌شود' } as Record<string, string>)[claim.coverageStatus] ?? claim.coverageStatus}</div>}
                    {claim.description && <div className="cv-note"><b>توضیحات ثبت پرونده: </b>{claim.description}</div>}
                  </div>
                )}
                {tab === 'docs' && (
                  <div className="overflow-x-auto">
                    <table className="table sn-table">
                      <thead><tr>{['#', 'مدرک', 'بارگذاری', ...desks.map((d) => DESK_FA[d]), ''].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                      <tbody>
                        {docRows.map((r, i) => (
                          <tr key={r.key} className={r.def?.open ? 'is-alloc' : ''}>
                            <td>{(i + 1).toLocaleString('fa-IR')}</td>
                            <td className="text-right">{r.label}{r.required && !r.doc ? <span style={{ color: '#c0172f' }}> *</span> : null}{r.def?.open && <span className="cv-defchip">نقص</span>}</td>
                            <td>{r.doc ? <span style={{ color: '#0f7a55' }}>✓ {r.doc.uploadedAt?.split(' ')[0] ?? ''}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                            {desks.map((d) => {
                              const st = r.doc?.reviews?.find((x) => x.stage === d)?.state;
                              return <td key={d} style={{ color: st === 'APPROVED' ? '#0f7a55' : st === 'REJECTED' ? '#c0172f' : 'var(--muted)', fontWeight: 700 }}>{st === 'APPROVED' ? '✓' : st === 'REJECTED' ? '✕' : '—'}</td>;
                            })}
                            <td>{r.doc && <button className="sn-act is-ghost" onClick={() => client.view(`/claims/${id}/documents/${r.doc!.id}/file`, 'org').catch((e) => setError(e.message))}>مشاهده</button>}
                              {(r.extras ?? []).map((x, k) => <button key={x.id} className="sn-act is-ghost" title="صفحهٔ افزوده با «+»" onClick={() => client.view(`/claims/${id}/documents/${x.id}/file`, 'org').catch((e) => setError(e.message))}>ص {(k + 2).toLocaleString('fa-IR')}</button>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 text-xs"><Link href={`/org/claims/${id}/documents`} className="ev-link">بارگذاری، تایید و رد مدارک در صفحهٔ «بررسی وضعیت مدارک»</Link></div>
                  </div>
                )}
                {tab === 'flow' && (
                  <div className="space-y-3">
                    {w && <WorkflowPanel claimId={id} workflow={{ ...w, actions: [] }} realm="org" onDone={reload} />}
                    {w && <div className="ev-like"><PaymentBox claimId={id} info={w as PaymentInfo} finalizedAmount={claim.finalizedAmount} closed={closed} onDone={reload} /></div>}
                    <WorkflowTimeline claimId={id} steps={claim.steps} realm="org" />
                  </div>
                )}
                {tab === 'heirs' && <HeirsCard claimId={id} realm="org" className="" />}
                {tab === 'defs' && (
                  (claim.deficiencies ?? []).length === 0 ? <div className="text-sm" style={{ color: 'var(--muted)' }}>این پرونده تاکنون عودت نشده است.</div> : (
                    <table className="table sn-table">
                      <thead><tr>{['#', 'اعلام‌کننده', 'تاریخ', 'موارد نقص', 'وضعیت'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(claim.deficiencies ?? []).map((d, i) => (
                          <tr key={i}>
                            <td>{(i + 1).toLocaleString('fa-IR')}</td>
                            <td>{d.raisedByLabel ?? '—'}</td>
                            <td className="text-xs">{d.createdAt ?? '—'}</td>
                            <td className="text-right"><ul className="list-disc mr-4">{d.items.map((x, j) => <li key={j}>{x}</li>)}</ul></td>
                            <td>{d.resolvedAt ? <span style={{ color: '#0f7a55' }}>رفع شد — {d.resolvedAt}</span> : <b style={{ color: '#c0172f' }}>باز</b>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
