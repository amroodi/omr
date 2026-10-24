'use client';
import { EstelamFrame, InfoCol, InfoRow, PANELS, SubHead } from '../shared';

/** ذینفع‌ها — who receives the payment (IBAN masked). */
export default function EstelamBeneficiaries() {
  return (
    <EstelamFrame>
      {(r) => {
        const b = r.beneficiaries || {};
        return (
          <>
            <SubHead title={PANELS[1].label} icon={PANELS[1].icon} />
            {b.type || b.names || b.ibanMasked ? (
              <div className="est-cols est-cols-1">
                <InfoCol title="ذینفعان پرونده">
                  <InfoRow label="نوع ذینفع" value={b.type} />
                  <InfoRow label="ذینفعان / وراث" value={b.names ? <span style={{ whiteSpace: 'pre-wrap' }}>{b.names}</span> : null} />
                  <InfoRow label="شبای ثبت‌شده" value={b.ibanMasked ? <bdi className="ltr-val">{b.ibanMasked}</bdi> : null} />
                </InfoCol>
              </div>
            ) : (
              <div className="est-card p-6 text-sm" style={{ color: 'var(--muted)' }}>اطلاعات ذینفعان هنوز در پرونده ثبت نشده است؛ پس از ارائهٔ گواهی انحصار وراثت ثبت می‌شود.</div>
            )}
          </>
        );
      }}
    </EstelamFrame>
  );
}
