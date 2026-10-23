'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '../components/ui';
import { BrandMark } from '../components/brand';
import { Icon } from '../components/Shell';
import { Faq } from '../components/Faq';
import { API_BASE, inquiryApi } from '../../lib/api';

const fmtAmt = (v: any) => (v != null && String(v).trim() !== '' ? `${Number(String(v).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال` : null);
const DEATH_TYPES = new Set(['DEATH_ILLNESS', 'DEATH_ACCIDENT']);

const ACTION_FA: Record<string, string> = {
  SUBMIT: 'ارسال مدارک', FORWARD: 'تایید و ارسال به مرحلهٔ بعد', REFER_COUNCIL: 'ارجاع به شورای فنی', PAY_ORDER: 'صدور دستور پرداخت',
  RETURN: 'عودت برای رفع نقص', RETURN_DIRECT: 'عودت برای رفع نقص', DOWN_FORWARD: 'ارسال به مرحلهٔ قبل', DOWN_DIRECT: 'ارسال به بیمه‌گزار',
  MARK_PAID: 'پرداخت خسارت', REJECT_FINAL: 'رد پرونده',
};

const PANELS = [
  ['track', 'پیگیری آخرین وضعیت', 'M12 22s8-4.5 8-11.5A8 8 0 004 10.5C4 17.5 12 22 12 22zM12 13a3 3 0 100-6 3 3 0 000 6z'],
  ['benef', 'ذینفع‌ها', 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'],
  ['online', 'پاسخگوی آنلاین', 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z'],
  ['faq', 'سوالات متداول', 'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z'],
  ['contact', 'تماس و ارتباط', 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z'],
] as const;
type Panel = (typeof PANELS)[number][0];

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="trk-chip">
      <span className="cap">{label}:</span>
      <b dir="ltr" style={{ unicodeBidi: 'isolate' }}>{value}</b>
    </span>
  );
}

function phaseText(r: any): string {
  if (r.status === 'PAID') return 'خسارت پرداخت شده است';
  if (r.status === 'REJECTED') return 'پرونده رد شده است';
  if (r.flowPurpose === 'PAYMENT') return 'دستور پرداخت صادر شده و پرونده در مسیر پرداخت است';
  if (r.flowDirection === 'DOWN') return 'پرونده برای رفع نقص مدارک بازگردانده شده است';
  if (r.currentStage === 'POLICYHOLDER') return 'در انتظار تکمیل و ارسال مدارک توسط بیمه‌گزار';
  return 'پرونده در حال بررسی است';
}

/** مشاهده سریع و استعلام پرونده — the inquiry result, shown on its own page (SVG «Group 872» design). */
export default function EstelamResult() {
  const [r, setR] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem('inquiryResult'); if (s) setR(JSON.parse(s));
      setToken(sessionStorage.getItem('inquiryToken'));
    } catch { /* private mode */ }
    setReady(true);
  }, []);

  const send = async () => {
    if (!token) return;
    setSending(true); setSent(null);
    try { const res = await inquiryApi.message(token, msg.trim()); setSent({ ok: true, text: res.message }); setMsg(''); }
    catch (e: any) { setSent({ ok: false, text: /token|expired|منقضی|Unauthorized/i.test(e.message) ? 'زمان این استعلام به پایان رسیده است؛ لطفاً دوباره استعلام کنید و سپس پیام بفرستید.' : e.message }); }
    finally { setSending(false); }
  };

  const isDeath = r ? DEATH_TYPES.has(r.claimType) : true;
  const eventLabel = isDeath ? 'تاریخ فوت' : 'تاریخ وقوع حادثه';
  const fields: [string, any][] = r
    ? [
        ['بیمه‌گر', r.insurerName],
        ['بیمه‌شده (متوفی)', r.deceasedName],
        ['کد ملی', r.nationalCodeMasked],
        ['تاریخ تولد', r.birthDate],
        [isDeath ? 'سن متوفی' : 'سن بیمه‌شده', r.deceasedAge != null ? `${Number(r.deceasedAge).toLocaleString('fa-IR')} سال` : null],
        ['نام شرکت / محل فعالیت', r.company?.name ?? r.companyName],
        ['شماره بیمه‌نامه', r.policyNumber],
        ['تاریخ شروع بیمه‌نامه', r.policyStartDate],
        ['سرمایه فوت', fmtAmt(r.deathCapital)],
        ['سرمایه حادثه', fmtAmt(r.accidentCapital)],
        ['مبلغ قابل پرداخت', fmtAmt(r.payableAmount)],
        ['علت فوت', r.causeOfDeath],
        [eventLabel, r.eventDate],
        ['تاریخ ثبت', r.createdAt],
      ]
    : [];
  const co = r?.company;
  const coLogo = co?.hasLogo ? `${API_BASE}/policyholder-companies/${co.id}/logo` : null;
  const cur = r?.chain?.findIndex((c: any) => c.stage === r.currentStage) ?? -1;
  const openDefs = (r?.deficiencies ?? []).filter((d: any) => !d.resolvedAt);

  return (
    <div style={{ minHeight: 'calc(100 * var(--zvh))', background: 'var(--panel-bg)' }}>
      {/* Navy top bar */}
      <div style={{ background: '#012141', height: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '0 clamp(16px,4vw,48px)' }}>
        <Link href="/" className="flex items-center gap-2 text-sm font-bold" style={{ color: '#fff' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1V9.5z" /></svg>
          صفحه اصلی
        </Link>
        <span style={{ flex: 1 }} />
        <span className="flex items-center gap-2" style={{ color: '#fff' }}>
          <BrandMark size={28} />
          <span className="font-extrabold">دامون</span>
        </span>
      </div>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px,3vw,34px)' }}>
        {!ready ? (
          <div className="flex justify-center p-16"><span className="pspinner" /></div>
        ) : !r ? (
          <div className="pcard p-10 text-center space-y-3" style={{ marginTop: 24 }}>
            <p style={{ color: 'var(--muted)' }}>اطلاعات استعلامی یافت نشد. لطفاً دوباره استعلام کنید.</p>
            <Link href="/" className="btn btn-solid btn-solid-lg inline-flex">استعلام جدید</Link>
          </div>
        ) : (
          <>
            {/* Navy rounded-top header card (designer skin) */}
            <div className="trk-head">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {coLogo && <img src={coLogo} alt="" style={{ width: 52, height: 52, objectFit: 'contain', background: '#fff', borderRadius: 12, padding: 4 }} />}
                  <div className="min-w-0">
                    <div className="trk-title">مشاهده سریع و استعلام پرونده</div>
                    {(co?.name || r.companyName) && <div className="trk-sub">بیمه‌گزار: {co?.name || r.companyName}</div>}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="font-bold">پرونده {r.claimNumber}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                </div>
                <Link href="/" className="trk-btn-back shrink-0"><Icon path="M9 18l6-6-6-6" /> استعلام جدید</Link>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {r.createdAt && <Chip label="تاریخ ثبت" value={r.createdAt} />}
                {r.eventDate && <Chip label={eventLabel} value={r.eventDate} />}
                {r.currentStageLabel && <Chip label="مرحلهٔ فعلی" value={r.currentStageLabel} />}
                {r.payableAmount && <Chip label="مبلغ قابل پرداخت" value={`${Number(String(r.payableAmount).replace(/[^\d]/g, '') || 0).toLocaleString('fa-IR')} ریال`} />}
              </div>
            </div>

            {/* Action buttons — each opens its panel */}
            <div className="grid gap-3 mt-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              {PANELS.map(([key, label, icon]) => (
                <button key={key} type="button" onClick={() => setPanel((p) => (p === key ? null : key))}
                  className={`pdiamond-wrap${panel === key ? ' is-active' : ''}`} style={{ minWidth: 0, padding: '16px 12px' }} aria-pressed={panel === key}>
                  <span style={{ color: 'var(--brand)' }}><Icon path={icon} /></span>
                  <span className="pdiamond-title">{label}</span>
                </button>
              ))}
            </div>

            {panel && (
              <div className="pcard p-5 mt-4">
                {panel === 'track' && (
                  <div className="space-y-4">
                    <div className="font-bold">{phaseText(r)}</div>
                    {r.chain && (
                      <div className="flex items-center gap-1 flex-wrap text-xs">
                        {r.chain.map((c: any, i: number) => (
                          <span key={c.stage} className="flex items-center gap-1">
                            <span className="rounded-full px-3 py-1.5 font-bold"
                              style={{ background: c.stage === r.currentStage ? 'var(--brand)' : i < cur && r.flowDirection === 'UP' ? 'var(--brand-soft)' : 'var(--surface-2)', color: c.stage === r.currentStage ? '#fff' : 'var(--muted)' }}>
                              {c.label}
                            </span>
                            {i < r.chain.length - 1 && <span style={{ color: 'var(--muted)' }}>›</span>}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.physicalAtLabel && <div className="text-sm">محل نگهداری اصل مدارک: <b>{r.physicalAtLabel}</b></div>}
                    {openDefs.length > 0 && (
                      <div className="text-sm rounded-lg p-3" style={{ background: 'var(--danger-soft)' }}>
                        <b>نقص‌های اعلام‌شده:</b>
                        <ul className="list-disc mr-5 mt-1">{openDefs.flatMap((d: any) => d.items).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    )}
                    <ol className="space-y-2">
                      {(r.steps ?? []).map((s: any) => (
                        <li key={s.order} className="flex gap-2 text-sm">
                          <span className="rounded-full shrink-0 flex items-center justify-center" style={{ width: 22, height: 22, fontSize: 11, color: '#fff', background: s.state === 'PENDING' ? 'var(--brand)' : 'var(--success)' }}>{Number(s.order).toLocaleString('fa-IR')}</span>
                          <span><b>{s.stageLabel || '—'}</b>: {s.state === 'PENDING' ? 'در انتظار اقدام' : ACTION_FA[s.action] || 'انجام شد'}{s.decidedAt ? <span style={{ color: 'var(--muted)' }}> — {s.decidedAt}</span> : null}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {panel === 'benef' && (
                  r.beneficiaries && (r.beneficiaries.type || r.beneficiaries.names || r.beneficiaries.ibanMasked) ? (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                      {r.beneficiaries.type && <div className="trk-info"><div><div className="lbl">نوع ذینفع</div><div className="val">{r.beneficiaries.type}</div></div></div>}
                      {r.beneficiaries.names && <div className="trk-info"><div><div className="lbl">ذینفعان / وراث</div><div className="val" style={{ whiteSpace: 'pre-wrap' }}>{r.beneficiaries.names}</div></div></div>}
                      {r.beneficiaries.ibanMasked && <div className="trk-info"><div><div className="lbl">شبای ثبت‌شده</div><div className="val" dir="ltr">{r.beneficiaries.ibanMasked}</div></div></div>}
                    </div>
                  ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>اطلاعات ذینفعان هنوز در پرونده ثبت نشده است؛ پس از ارائهٔ گواهی انحصار وراثت ثبت می‌شود.</p>
                )}

                {panel === 'online' && (
                  <div className="space-y-3">
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>سوال خود را دربارهٔ این پرونده بنویسید. پیام برای بیمه‌گزار و کارگزاری ارسال می‌شود و کارشناس با شمارهٔ موبایلی که با آن استعلام کردید تماس می‌گیرد.</p>
                    {sent && <div className={sent.ok ? 'alert-success' : 'alert-error'}>{sent.text}</div>}
                    {token ? (
                      <>
                        <textarea className="input" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} placeholder="متن پیام…" />
                        <button onClick={send} disabled={sending || msg.trim().length < 3} className="btn btn-solid">{sending ? 'در حال ارسال…' : 'ارسال پیام'}</button>
                      </>
                    ) : <Link href="/" className="btn btn-solid inline-flex">برای ارسال پیام دوباره استعلام کنید</Link>}
                  </div>
                )}

                {panel === 'faq' && <Faq />}

                {panel === 'contact' && (
                  <div className="space-y-4">
                    {co ? (
                      <div className="flex gap-4 items-start flex-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {coLogo && <img src={coLogo} alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />}
                        <div className="space-y-1.5 text-sm">
                          <div className="font-extrabold text-base">{co.name}</div>
                          {co.contactName && <div>مسئول پیگیری: <b>{co.contactName}</b></div>}
                          {co.phone && <div>تلفن: <a href={`tel:${co.phone}`} dir="ltr" style={{ color: 'var(--brand)', fontWeight: 700 }}>{co.phone}</a></div>}
                          {co.email && <div>ایمیل: <a href={`mailto:${co.email}`} dir="ltr" style={{ color: 'var(--brand)' }}>{co.email}</a></div>}
                          {co.website && <div>وب‌سایت: <a href={/^https?:/.test(co.website) ? co.website : `https://${co.website}`} target="_blank" rel="noreferrer" dir="ltr" style={{ color: 'var(--brand)' }}>{co.website}</a></div>}
                          {co.address && <div>نشانی: {co.address}</div>}
                          {!co.phone && !co.email && !co.address && <div style={{ color: 'var(--muted)' }}>اطلاعات تماس این بیمه‌گزار هنوز ثبت نشده است.</div>}
                        </div>
                      </div>
                    ) : <p className="text-sm" style={{ color: 'var(--muted)' }}>اطلاعات تماس بیمه‌گزار ثبت نشده است.</p>}
                    {r.broker && (
                      <div className="text-sm border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                        <div className="font-bold">{r.broker.name}</div>
                        {r.broker.contact && <div style={{ color: 'var(--muted)' }}>{r.broker.contact}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Info fields (designer cards) */}
            <div className="grid gap-3 mt-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {fields.filter(([, v]) => v).map(([l, v]) => (
                <div key={l} className="trk-info">
                  <span className="ico"><Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6" /></span>
                  <div className="min-w-0"><div className="lbl">{l}</div><div className="val" style={{ wordBreak: 'break-word' }}>{v}</div></div>
                </div>
              ))}
            </div>

            <div className="text-center mt-6 no-print">
              <Link href="/" className="btn btn-ghost btn-sm">بازگشت به صفحهٔ اصلی</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
