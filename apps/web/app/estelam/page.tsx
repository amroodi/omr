'use client';
import Link from 'next/link';
import { StatusBadge } from '../components/ui';
import { Icon } from '../components/Shell';
import { LogoTile } from '../components/LogoTile';
import { API_BASE } from '../../lib/api';
import { DEATH_TYPES, EstelamFrame, InfoCol, InfoRow, PANELS, fmtAmt, phaseText, useExit } from './shared';

const CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z';

/** مشاهده سریع و استعلام پرونده — the inquiry result: header card, three info columns, then the five actions. */
export default function EstelamResult() {
  return <EstelamFrame>{(r) => <Result r={r} />}</EstelamFrame>;
}

function Result({ r }: { r: any }) {
  const exit = useExit();
  const isDeath = DEATH_TYPES.has(r.claimType);
  const co = r.company;
  const coLogo = co?.hasLogo ? `${API_BASE}/policyholder-companies/${co.id}/logo` : null;
  const age = r.deceasedAge != null ? `${Number(r.deceasedAge).toLocaleString('fa-IR')} سال` : null;

  return (
    <>
      {/* Header card: title + company + dates | case notes | exit */}
      <div className="est-hero">
        <div className="est-hero-main">
          <div className="est-hero-title">
            {coLogo ? <LogoTile src={coLogo} size={44} /> : <span className="est-hero-ico"><Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5" /></span>}
            مشخصات بیمه‌نامه
            <StatusBadge status={r.status} />
          </div>
          {(co?.name || r.companyName) && <div className="est-hero-sub">{co?.name || r.companyName}</div>}
          <div className="est-dates">
            {!(r.imported && (r.status === 'PAID' || r.status === 'REJECTED')) && <div><div className="est-date-l">تاریخ ثبت اولیه</div><div className="est-date-v"><Icon path={CAL} /> {r.createdAt || '—'}</div></div>}
            <div><div className="est-date-l">تاریخ پرداخت</div><div className="est-date-v"><Icon path={CAL} /> {r.paidDate || '—'}</div></div>
          </div>
        </div>
        <div className="est-notes">
          <div className="est-notes-l">توضیحات پرونده</div>
          <div className="est-pill"><span className="est-pill-dot" />{r.caseNotes || phaseText(r)}</div>
        </div>
        <button type="button" onClick={exit} className="est-exit"><Icon path="M15 3H5a2 2 0 00-2 2v14a2 2 0 002 2h10M17 16l4-4-4-4M21 12H9" /> خروج</button>
      </div>

      {/* Three info columns */}
      <div className="est-cols">
        <InfoCol title="اطلاعات بیمه‌شده">
          <InfoRow label="نام و نام خانوادگی" value={r.deceasedName ? (isDeath ? `مرحوم ${r.deceasedName}` : r.deceasedName) : null} />
          <InfoRow label="کد ملی" value={(r.nationalCode || r.nationalCodeMasked) ? <bdi className="ltr-val">{r.nationalCode || r.nationalCodeMasked}</bdi> : null} />
          <InfoRow label="تاریخ تولد" value={r.birthDate} />
          <InfoRow label={isDeath ? 'سن هنگام فوت' : 'سن هنگام حادثه'} value={age} />
          <InfoRow label="نام شرکت محل فعالیت" value={co?.name || r.companyName} />
        </InfoCol>
        <InfoCol title="اطلاعات بیمه‌نامه">
          <InfoRow label="بیمه‌گر" value={r.insurerName} />
          <InfoRow label="شماره بیمه‌نامه" value={r.policyNumber ? <bdi className="ltr-val">{r.policyNumber}</bdi> : null} />
          <InfoRow label="تاریخ شروع بیمه‌نامه" value={r.policyStartDate} />
          <InfoRow label="سرمایه فوت" value={fmtAmt(r.deathCapital)} />
          <InfoRow label="سرمایه حادثه" value={fmtAmt(r.accidentCapital)} />
          <InfoRow label="مبلغ قابل پرداخت" value={fmtAmt(r.payableAmount)} />
        </InfoCol>
        <InfoCol title={isDeath ? 'اطلاعات فوت' : 'اطلاعات حادثه'}>
          {isDeath && <InfoRow label="علت فوت" value={r.causeOfDeath} />}
          <InfoRow label={isDeath ? 'تاریخ فوت' : 'تاریخ حادثه'} value={r.eventDate} />
          <InfoRow label="ذینفع" value={r.beneficiaries?.type} />
          <InfoRow label="مرحلهٔ فعلی" value={r.currentStageLabel} />
        </InfoCol>
      </div>

      {/* The five actions, each its own page */}
      <div className="est-actions">
        {PANELS.map((p) => (
          <Link key={p.href} href={p.href} className="est-btn"><Icon path={p.icon} /> {p.label}</Link>
        ))}
      </div>
    </>
  );
}
