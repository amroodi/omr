'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { pickedClaim, inquiryApi } from '../../../lib/api';
import { downloadPdf } from '../../../lib/pdf';
import { Icon } from '../../components/Shell';
import { blankVal, fmtAmount, ICONS, StatusHistoryButton, WF_STEPS } from '../../components/case-ui';
import { EstelamFrame, SIDE_MENU, SubHead, phaseText, phaseTone } from '../shared';

const REFRESH_MS = 30_000;
const faD = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

/**
 * «وضعیت پرونده» — every executive step with its date and status, in the inquiry panel's one look (white
 * card, green heading, light rows). While the inquiry is still valid it re-reads the case every 30
 * seconds, so it follows the workflow live.
 */
export default function EstelamTrack() {
  const menu = SIDE_MENU[1];
  return (
    <EstelamFrame>
      {(r, token) => (
        <>
          <SubHead title={menu.label} icon={menu.icon} />
          <TrackBody first={r} token={token} />
        </>
      )}
    </EstelamFrame>
  );
}

function TrackBody({ first, token }: { first: any; token: string | null }) {
  const [r, setR] = useState<any>(first);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { setR(first); }, [first]);

  // Live follow-up: every 30 s until the inquiry token runs out.
  useEffect(() => {
    if (!token) return;
    let stop = false;
    const tick = async () => {
      try {
        const fresh = await inquiryApi.getCase(token, pickedClaim());
        if (stop) return;
        setR(fresh); setUpdatedAt(new Date());
        try { sessionStorage.setItem('inquiryResult', JSON.stringify(fresh)); } catch { /* ignore */ }
      } catch { if (!stop) setExpired(true); }
    };
    const t = setInterval(() => { if (!document.hidden && !expired) tick(); }, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [token, expired]);

  const pdf = async () => {
    if (!sheet.current) return;
    setSaving(true);
    try { await downloadPdf(sheet.current, `track-${r.policyNumber || r.claimNumber}`); } finally { setSaving(false); }
  };

  const fv: Record<string, string> = r.stages ?? {};
  const notes = r.caseNotes || fv.case_notes || phaseText(r);
  return (
    <>
      <div ref={sheet} className="est-card p-6 space-y-5">
        <div className="cu-summary">
          <p>
            <span className={`est-pill tone-${phaseTone(r, notes)}`}><span className="est-pill-dot" />{notes}</span>
          </p>
          <dl>
            {!(r.imported && (r.status === 'PAID' || r.status === 'REJECTED')) && <><dt>تاریخ ثبت اولیه:</dt><dd>{r.createdAt || '—'}</dd></>}
            <dt>تاریخ پرداخت:</dt><dd>{blankVal(r.paidDate) ? '—' : r.paidDate}</dd>
            <dt>مرحلهٔ فعلی:</dt><dd>{r.currentStageLabel || '—'}</dd>
          </dl>
        </div>
        <section className="cu-process">
          <h3>مراحل اجرایی پرونده</h3>
          <div>
            {WF_STEPS.map((s) => {
              const date = s.date && !blankVal(fv[s.date]) ? fv[s.date] : '';
              const raw = s.status && !blankVal(fv[s.status]) ? fv[s.status] : '';
              const status = raw && s.amount ? (fmtAmount(raw) ?? raw) : raw;
              const done = !!(date || status);
              return (
                <div key={s.label} className="cu-kv est-step">
                  <b>{s.label} :</b>
                  <span className="est-step-v">
                    <span className="min-w-0">{status || '—'}{date ? <span className="est-step-d"> — {faD(date)}</span> : null}</span>
                    <span className={`cs-mark ${done ? 'is-ok' : 'is-wait'}`} title={done ? 'ثبت شده' : 'هنوز ثبت نشده'}><Icon path={done ? 'M20 6L9 17l-5-5' : 'M7 12h10'} /></span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <div className="est-live no-pdf" aria-live="polite">
        {expired
          ? <>زمان این استعلام به پایان رسیده است؛ برای دیدن آخرین وضعیت <Link href="/">دوباره استعلام کنید</Link>.</>
          : <><span className="trk2-dot" />پیگیری زنده — هر ۳۰ ثانیه به‌روز می‌شود{updatedAt ? ` (آخرین به‌روزرسانی: ${updatedAt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tehran' })})` : ''}</>}
      </div>
      <div className="est-actions no-pdf">
        <button type="button" className="est-btn" onClick={pdf} disabled={saving}><Icon path={ICONS.pdf} /> {saving ? 'در حال ساخت…' : 'دانلود PDF'}</button>
        <StatusHistoryButton story={r.story} className="est-btn" />
        <Link href="/estelam/documents" className="est-btn"><Icon path={ICONS.doc} /> بررسی وضعیت مدارک</Link>
      </div>
    </>
  );
}
