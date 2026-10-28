'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { client, hasPerm } from '../../../../lib/client';
import { Shell, Icon } from '../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../components/ui';
import { ORG_NAV } from '../../nav';
import { WorkflowPanel } from '../../../components/WorkflowPanel';
import { caseTitle } from '../../../../lib/caseTitle';
import { CaseHero, CaseSummary, DEATH_TYPES, ICONS, phaseText, useCase } from '../../../components/case-ui';
import { CaseEditForm } from './case-edit';

const ICON_ASSESS = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0 2 2 0 00-4 0zM9 14l2 2 4-4';

/**
 * The case page. «پیش‌نمایش» opens with the policy summary (Group 873) and two buttons to the case's
 * sub-pages — «بررسی وضعیت مدارک» (documents, desk ✓/✕ and the workflow route) and «مراحل و وضعیت گردش
 * کار» (executive steps) — then the workflow actions. «ویرایش» is the field editor only; «ارزیابی»
 * opens the two-pane assessment page.
 */
export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { claim, fv, error, setError, reload } = useCase(id);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [perms, setPerms] = useState({ del: false, exp: false });
  useEffect(() => { setPerms({ del: hasPerm('org', 'claim:delete'), exp: hasPerm('org', 'export:list') }); }, []);
  const [lateWarn, setLateWarn] = useState(true); // org's "show late-notice warning" setting
  // «ویرایش» (the hand-filled field editor) belongs to the brokerage; an insurer's panel doesn't have it.
  const [isInsurer, setIsInsurer] = useState(false);
  useEffect(() => { client.get<{ lateNoticeWarning?: boolean; kind?: string }>('/tenant/branding', 'org').then((b) => { setLateWarn(b.lateNoticeWarning !== false); setIsInsurer(b.kind === 'INSURER'); }).catch(() => {}); }, []);

  const removeClaim = async () => {
    if (!claim) return;
    if (!window.confirm(`حذف ${caseTitle(claim)}؟ پرونده به سطل بازیافت منتقل می‌شود و تا ۱۴ روز قابل بازیابی است؛ پس از آن برای همیشه حذف خواهد شد.`)) return;
    setError(''); setBusy(true);
    try { await client.del(`/claims/${id}`, 'org'); router.push('/org/claims/trash'); }
    catch (e: any) { setError(e.message); setBusy(false); }
  };

  const name = claim ? (claim.deceasedName || fv.full_name || '—') : '';
  const editTitle = claim && DEATH_TYPES.has(claim.claimType) && !name.startsWith('مرحوم') ? `مرحوم ${name}` : name;

  return (
    <Shell title={claim ? caseTitle(claim) : 'پرونده خسارت'} nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده" /></div> : (
        <div className="space-y-5">
          {claim.lateNotice && lateWarn && (
            <div className="alert-error">⚠ اعلام خسارت خارج از مهلت مقرر انجام شده است (مهلت: {claim.noticeDeadline}).</div>
          )}

          {/* Tabs: پیش‌نمایش ↔ ویرایش, and the assessment page */}
          <div className="flex items-center justify-between gap-2 flex-wrap no-print">
            <div className="inline-flex rounded-xl p-1 text-sm" style={{ background: 'var(--surface-2)' }}>
              <button onClick={() => setMode('preview')} className={`btn btn-sm ${mode === 'preview' ? 'btn-primary' : 'btn-ghost'}`}>پیش‌نمایش</button>
              {!isInsurer && <button onClick={() => setMode('edit')} className={`btn btn-sm ${mode === 'edit' ? 'btn-primary' : 'btn-ghost'}`}>ویرایش</button>}
              <Link href={`/org/claims/${id}/assess`} className="btn btn-sm btn-ghost" title="ارزیابی و تایید مدارک در صفحهٔ دوستونه"><Icon path={ICON_ASSESS} /> ارزیابی پرونده</Link>
              <a href={`/org/reminders?claim=${id}&n=${encodeURIComponent(claim.claimNumber)}`} target="_blank" rel="noopener" className="btn btn-sm btn-ghost" title="یادآوری پیگیری این پرونده برای خودتان یا همکار"><Icon path="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /> یادآور</a>
            </div>
            {mode === 'preview' && perms.exp && (
              <button onClick={() => client.download(`/exports/claim/${id}.xlsx`, 'org', `claim-${claim.policyNumber || claim.claimNumber}.xlsx`)} className="btn btn-ghost btn-sm" title="خروجی اکسل این پرونده"><Icon path={ICONS.pdf} /> خروجی اکسل</button>
            )}
          </div>

          {mode === 'preview' || isInsurer ? (
            <>
              <div className="cs-sheet">
                <CaseHero title="مشخصات بیمه‌نامه" claim={claim} notes={fv.case_notes || phaseText(claim)} />
                <CaseSummary claim={claim} fv={fv} />
              </div>
              <div className="cs-actions">
                <Link href={`/org/claims/${id}/documents`} className="cs-act"><Icon path={ICONS.doc} /> بررسی وضعیت مدارک</Link>
                <Link href={`/org/claims/${id}/workflow`} className="cs-act is-alt"><Icon path={ICONS.list} /> مراحل و وضعیت گردش کار</Link>
              </div>
              {claim.description && (
                <div className="card p-4 text-sm whitespace-pre-wrap"><b>توضیحات ثبت پرونده: </b><span style={{ color: 'var(--muted)' }}>{claim.description}</span></div>
              )}
              {/* Workflow actions the server offers this user (send on / return / payment…) */}
              {claim.workflow && (
                <div className="card p-4 no-print">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-extrabold flex items-center gap-2"><span className="sec-ico"><Icon path={ICONS.route} /></span>اقدام روی پرونده</h3>
                    {perms.del && <button onClick={removeClaim} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} title="انتقال به سطل بازیافت (۱۴ روز قابل بازیابی)">حذف پرونده</button>}
                  </div>
                  <WorkflowPanel claimId={id} workflow={claim.workflow} realm="org" onDone={reload} />
                </div>
              )}
            </>
          ) : (
            <CaseEditForm claimId={id} title={editTitle} onSaved={reload} />
          )}
        </div>
      )}
    </Shell>
  );
}
