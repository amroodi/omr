'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell, Icon } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { ORG_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { downloadPdf } from '../../../../../lib/pdf';
import { CaseHero, ICONS, PersonCards, phaseText, useCase, WorkflowStepsTable } from '../../../../components/case-ui';


/** «مراحل و وضعیت گردش کار» (Group 874): every executive step with its date and status, as a table. */
export default function CaseWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { claim, fv, error, setError } = useCase(id);
  const sheet = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const pdf = async () => {
    if (!sheet.current || !claim) return;
    setSaving(true);
    try { await downloadPdf(sheet.current, `workflow-${claim.policyNumber || claim.claimNumber}`); }
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
            <WorkflowStepsTable claim={claim} fv={fv} />
          </div>
          <div className="cs-actions no-print">
            <button type="button" className="cs-act" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت PDF…' : 'دانلود PDF'}</button>
            <Link href={`/org/claims/${id}/documents`} className="cs-act is-alt"><Icon path={ICONS.doc} /> بررسی وضعیت مدارک</Link>
          </div>
        </>
      )}
    </Shell>
  );
}
