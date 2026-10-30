'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '../../../../../lib/client';
import { Shell } from '../../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../../components/ui';
import { WorkflowPanel } from '../../../../components/WorkflowPanel';
import { ProcessTimeline, ResultBox } from '../../../../components/ProcessTimeline';
import { CUSTOMER_NAV } from '../../../nav';
import { caseTitle } from '../../../../../lib/caseTitle';
import { CaseHero, PersonCards, phaseText, useCase, WorkflowStepsTable } from '../../../../components/case-ui';

/**
 * بیمه‌گزار — «روند پرونده»: the same steps table as the org «مراحل و وضعیت گردش کار» page (dates and
 * statuses of each executive step), then where the case is in the chain and every hand-off so far.
 */
export default function CustomerCaseWorkflow() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { claim, fv, error, reload } = useCase(id, 'customer');
  useEffect(() => { if (!getToken('customer')) router.push('/customer/login'); }, [router]);

  return (
    <Shell title={claim ? `روند ${caseTitle(claim)}` : 'روند پرونده'} breadcrumb="روند پرونده" sectionLabel="خسارت عمر و حادثه" nav={CUSTOMER_NAV} realm="customer">
      <ErrorBox message={error} />
      {!claim ? <div className="pcard p-12 flex justify-center"><FancyLoader label="در حال بارگذاری روند پرونده" /></div> : (
        <div className="space-y-5">
          <div className="cs-sheet">
            <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={fv.case_notes || phaseText(claim)} steps back={`/customer/claims/${id}`} exitHref="/customer/claims" />
            <PersonCards claim={claim} fv={fv} />
            <WorkflowStepsTable claim={claim} fv={fv} />
          </div>
          <div className="pcard p-6 space-y-5">
            <ResultBox c={claim as any} />
            <ProcessTimeline c={claim as any} fv={fv} />
            {/* sending the documents on is «ثبت نهایی» on the case page (it shows the outcome page) */}
            {claim.workflow && (claim.workflow.actions.some((a) => a.key !== 'SUBMIT') || (claim.workflow.physical?.actions.length ?? 0) > 0) && (
              <WorkflowPanel claimId={id} workflow={{ ...claim.workflow, actions: claim.workflow.actions.filter((a) => a.key !== 'SUBMIT') }} realm="customer" onDone={reload} />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
