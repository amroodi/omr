'use client';
import { LogoTile } from '../../components/LogoTile';
import { API_BASE } from '../../../lib/api';
import { EstelamFrame, InfoCol, InfoRow, PANELS, SubHead } from '../shared';

const link = { color: 'var(--est-accent)', fontWeight: 700 } as const;

/** تماس و ارتباط — the بیمه‌گزار company and the brokerage the requester can contact. */
export default function EstelamContact() {
  return (
    <EstelamFrame>
      {(r) => {
        const co = r.company;
        return (
          <>
            <SubHead title={PANELS[4].label} icon={PANELS[4].icon} />
            <div className="est-cols est-cols-2">
              <InfoCol title="بیمه‌گزار">
                {co ? (
                  <>
                    <div className="flex items-center gap-3 mb-1">
                      {co.hasLogo && <LogoTile src={`${API_BASE}/policyholder-companies/${co.id}/logo`} size={56} />}
                      <b className="text-base">{co.name}</b>
                    </div>
                    <InfoRow label="مسئول پیگیری" value={co.contactName} />
                    <InfoRow label="تلفن" value={co.phone ? <a href={`tel:${co.phone}`} dir="ltr" style={link}>{co.phone}</a> : null} />
                    <InfoRow label="ایمیل" value={co.email ? <a href={`mailto:${co.email}`} dir="ltr" style={link}>{co.email}</a> : null} />
                    <InfoRow label="وب‌سایت" value={co.website ? <a href={/^https?:/.test(co.website) ? co.website : `https://${co.website}`} target="_blank" rel="noreferrer" dir="ltr" style={link}>{co.website}</a> : null} />
                    <InfoRow label="نشانی" value={co.address} />
                  </>
                ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>اطلاعات تماس بیمه‌گزار ثبت نشده است.</p>}
              </InfoCol>
              <InfoCol title="کارگزاری">
                <InfoRow label="نام" value={r.broker?.name || 'کارگزاری رسمی بیمه آتیه اندیشان دامون'} />
                <InfoRow label="راه ارتباط" value={r.broker?.contact} />
              </InfoCol>
            </div>
          </>
        );
      }}
    </EstelamFrame>
  );
}
