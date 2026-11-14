'use client';
import { DeathNoticeDate } from '../../../../components/DeathNoticeDate';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell, Icon } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { ORG_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { downloadBrandedPdf } from '../../../../../lib/pdf';
import { CaseHero, ICONS, PersonCards, phaseText, STATUS_FA, StatusHistoryButton, useCase } from '../../../../components/case-ui';
import { ProcessTimeline, ResultBox, StatusReportBody } from '../../../../components/ProcessTimeline';


/**
 * «مراحل و وضعیت گردش کار» (panel 2) and «روند پرونده» (an organization's panel 1): the case header, then the
 * same «وضعیت پرونده» timeline panel 3 shows — filing, every hand-off, the originals, payment.
 */
export default function CaseWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { claim, fv, error, setError } = useCase(id);
  const sheet = useRef<HTMLDivElement>(null);
  const report = useRef<HTMLDivElement>(null); // «گزارش وضعیت پرونده خسارت», drawn off screen for the PDF
  const [saving, setSaving] = useState(false);

  const pdf = async () => {
    if (!report.current || !claim) return;
    setSaving(true);
    const finalStatus = claim.story?.manual ? (claim.story.caseStage || STATUS_FA[claim.status] || claim.status) : (STATUS_FA[claim.status] ?? claim.status);
    try { await downloadBrandedPdf(report.current, `workflow-${claim.policyNumber || claim.claimNumber}`, { title: 'گزارش وضعیت پرونده خسارت', meta: [{ label: 'وضعیت نهایی', value: finalStatus }] }); }
    catch (e: any) { setError(e?.message || 'ساخت فایل PDF ممکن نشد'); } finally { setSaving(false); }
  };

  return (
    <Shell title={claim ? `گردش کار — ${caseTitle(claim)}` : 'مراحل و وضعیت گردش کار'} breadcrumb="مراحل و وضعیت گردش کار" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!claim ? <div className="card p-12 flex justify-center"><FancyLoader label="در حال بارگذاری پرونده" /></div> : (
        <>
          <div ref={sheet} className="cs-sheet">
            <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={fv.case_notes || phaseText(claim)} back={`/org/claims/${id}`} />
            <PersonCards claim={claim} fv={fv} />
          </div>
          <div className="pcard p-6 space-y-5 mt-4">
            <DeathNoticeDate claimId={id} />
            <ResultBox c={claim as any} />
            <ProcessTimeline c={claim as any} fv={fv} />
          </div>
          <div className="pdf-offscreen" aria-hidden="true"><div ref={report}><StatusReportBody c={claim} fv={fv} notes={fv.case_notes || phaseText(claim)} /></div></div>
          <div className="cs-actions no-print">
            <button type="button" className="cs-act" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت PDF…' : 'دانلود PDF'}</button>
            <Link href={`/org/claims/${id}/documents`} className="cs-act is-alt"><Icon path={ICONS.doc} /> بررسی وضعیت مدارک</Link>
            <StatusHistoryButton story={claim.story} className="cs-act is-alt" />
          </div>
        </>
      )}
    </Shell>
  );
}
