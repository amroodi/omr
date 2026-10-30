'use client';
import { ProcessTimeline, ResultBox } from '../../components/ProcessTimeline';
import { EstelamFrame, SIDE_MENU, SubHead } from '../shared';

/** The inquiry result in the shape the بیمه‌گزار panel's «فرایند رسیدگی پرونده» reads. */
function asClaim(r: any) {
  return {
    id: '', claimNumber: r.claimNumber, policyNumber: r.policyNumber, status: r.status, claimType: r.claimType,
    deceasedName: r.deceasedName, eventDate: r.eventDate, createdAt: r.createdAt, paidDate: r.paidDate,
    noticeDeadline: null, lateNotice: false,
    claimedAmount: r.claimedAmount ?? '', finalizedAmount: r.finalizedAmount ?? null, payableAmount: r.payableAmount ?? undefined,
    currentStageLabel: r.currentStageLabel, flowDirection: r.flowDirection, flowPurpose: r.flowPurpose,
    imported: !!r.imported, story: r.story, steps: r.steps ?? [],
  };
}

/** «فرایند رسیدگی پرونده» — the same timeline the بیمه‌گزار sees in its panel: filing, every hand-off, payment. */
export default function EstelamProcess() {
  const menu = SIDE_MENU[2];
  return (
    <EstelamFrame>
      {(r) => (
        <>
          <SubHead title={menu.label} icon={menu.icon} />
          {r.kind !== 'claim' ? (
            <div className="est-card p-8 text-center" style={{ color: 'var(--muted)' }}>فرایند رسیدگی برای این پرونده در دسترس نیست.</div>
          ) : (
            <div className="est-card p-6 space-y-5">
              <ResultBox c={asClaim(r) as any} />
              <ProcessTimeline c={asClaim(r) as any} fv={{ cause_of_death: r.causeOfDeath ?? '' }} />
            </div>
          )}
        </>
      )}
    </EstelamFrame>
  );
}
