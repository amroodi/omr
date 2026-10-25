'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { inquiryApi } from '../../../lib/api';
import { downloadPdf } from '../../../lib/pdf';
import { BrandMark } from '../../components/brand';
import { Icon } from '../../components/Shell';
import { Spinner } from '../../components/ui';
import { CaseClaim, CaseHero, ICONS, PersonCards, phaseText, WorkflowStepsTable } from '../../components/case-ui';

const REFRESH_MS = 30_000;

/** The inquiry result in the shape the shared case components read. */
function asCase(r: any): CaseClaim {
  return {
    id: '', claimNumber: r.claimNumber, policyNumber: r.policyNumber, status: r.status, claimType: r.claimType,
    deceasedName: r.deceasedName, eventDate: r.eventDate, createdAt: r.createdAt, paidDate: r.paidDate,
    noticeDeadline: null, lateNotice: false, claimedAmount: '0',
    currentStageLabel: r.currentStageLabel, flowDirection: r.flowDirection, flowPurpose: r.flowPurpose,
    policyholderCompany: r.company?.name || r.companyName ? { name: r.company?.name || r.companyName, phone: null } : null,
  };
}

/**
 * «پیگیری آخرین وضعیت» (Group 872): the navy-framed tracking sheet — header card with the dates and the
 * case notes, the deceased and the company, every executive step with its date and status, and a PDF.
 * While the inquiry is still valid the page re-reads the case every 30 seconds, so it follows the
 * workflow live.
 */
export default function EstelamTrack() {
  const [r, setR] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem('inquiryResult'); if (s) setR(JSON.parse(s));
      setToken(sessionStorage.getItem('inquiryToken'));
    } catch { /* private mode */ }
    setReady(true);
  }, []);

  // Live follow-up: refresh now and every 30 s until the inquiry token runs out.
  useEffect(() => {
    if (!token) return;
    let stop = false;
    const tick = async () => {
      try {
        const fresh = await inquiryApi.getCase(token);
        if (stop) return;
        setR(fresh); setUpdatedAt(new Date());
        try { sessionStorage.setItem('inquiryResult', JSON.stringify(fresh)); } catch { /* ignore */ }
      } catch { if (!stop) setExpired(true); }
    };
    tick();
    const t = setInterval(() => { if (!document.hidden && !expired) tick(); }, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [token, expired]);

  const pdf = async () => {
    if (!sheet.current || !r) return;
    setSaving(true);
    try { await downloadPdf(sheet.current, `track-${r.policyNumber || r.claimNumber}`); } finally { setSaving(false); }
  };

  const claim = r ? asCase(r) : null;
  const fv: Record<string, string> = r ? { ...(r.stages || {}), ...(r.companyName && !r.stages?.company_name ? { company_name: r.companyName } : {}), ...(r.deceasedName ? { full_name: r.deceasedName } : {}) } : {};

  return (
    <div className="trk2">
      <header className="trk2-top">
        <Link href="/" className="trk2-brand" aria-label="دامون"><BrandMark size={34} /><span>دامون</span></Link>
        <nav className="trk2-nav">
          <Link href="/"><Icon path="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" /> صفحه اصلی</Link>
          <Link href="/customer/login" className="trk2-login"><Icon path="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /> ورود</Link>
        </nav>
      </header>

      <main className="trk2-main">
        {!ready ? <div className="flex justify-center p-16"><Spinner /></div> : !claim ? (
          <div className="pcard p-10 text-center space-y-4">
            <p style={{ color: 'var(--muted)' }}>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="cs-act inline-flex">استعلام جدید</Link>
          </div>
        ) : (
          <>
            <div ref={sheet} className="cs-sheet">
              <CaseHero title="پیگیری آخرین وضعیت پرونده خسارت" claim={claim} notes={r.caseNotes || fv.case_notes || phaseText(claim)} back="/estelam" exitHref="/" />
              <PersonCards claim={claim} fv={fv} />
              <WorkflowStepsTable claim={claim} fv={fv} />
            </div>
            <div className="trk2-live no-pdf" aria-live="polite">
              {expired
                ? <>زمان این استعلام به پایان رسیده است؛ برای دیدن آخرین وضعیت <Link href="/">دوباره استعلام کنید</Link>.</>
                : <><span className="trk2-dot" />پیگیری زنده — هر ۳۰ ثانیه به‌روز می‌شود{updatedAt ? ` (آخرین به‌روزرسانی: ${updatedAt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})` : ''}</>}
            </div>
            <div className="trk2-actions no-pdf">
              <button type="button" className="trk2-pdf" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت…' : 'دانلود PDF'}</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
