'use client';
import { useState } from 'react';
import { client } from '../../lib/client';
import { ConcessionPaper, ConcessionSection } from './paper/ConcessionPaper';
import { PaperModal, Values } from './paper/Paper';

export interface Concession {
  id: string; status: string; statusLabel: string; details: string | null; at: string;
  fields: Values; signatures: Partial<Record<ConcessionSection, { name: string; at: string }>>; section: ConcessionSection | null;
}

/** What panel 2 is told about a case's payment (see the API's paymentView). */
export interface PaymentInfo {
  amountApproval?: { at: string; by: string | null } | null;
  paymentAuthorities?: { id: string; ceiling: string; status: string; statusLabel: string; grantee: string; grantedBy: string | null; byCouncil: boolean; at: string; closedAt: string | null; note: string | null }[];
  concessions?: Concession[];
  canStartConcession?: boolean;
  myStage?: string | null;
}

const rial = (v: string | number) => `${Number(v).toLocaleString('fa-IR')} ریال`;

/**
 * «تایید مبلغ، مجوز سرپرستی و فرم ارفاقی»: whether ستاد approved شعبه's amount, the مجوز سرپرستی (حدود اختیار)
 * ستاد gave for this case (to whom, up to how much, and whether it was used), and the «فرم گزارش خسارت ارفاقی»:
 * شعبه starts it, each desk fills and registers its own section on the sheet.
 */
export function PaymentBox({ claimId, info, finalizedAmount, onDone }: { claimId: string; info: PaymentInfo; finalizedAmount?: string | null; closed?: boolean; onDone: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auths = info.paymentAuthorities ?? [];
  const active = auths.find((a) => a.status === 'ACTIVE');
  const list = info.concessions ?? [];
  const cur = list.find((c) => c.id === openId) ?? null;
  const open = (c: Concession) => { setDraft(c.fields ?? {}); setError(''); setOpenId(c.id); };
  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true); setError('');
    try { await fn(); if (close) setOpenId(null); onDone(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const start = () => run(async () => {
    const r = await client.post<{ workflow?: PaymentInfo }>(`/claims/${claimId}/concessions`, {}, 'org');
    const c = (r?.workflow?.concessions ?? []).find((x) => x.section === 'BRANCH');
    if (c) open(c);
  });
  const SIGN_FA: Record<ConcessionSection, string> = { BRANCH: 'ثبت بخش شعبه', HQ: 'ثبت بخش مدیریت بیمه های اشخاص', COUNCIL: 'ثبت بخش شورای فنی' };
  return (
    <div className="ev-item pay-box">
      <div className="ev-item-head"><b>پرداخت خسارت</b><span>{active ? 'مجوز سرپرستی فعال' : ''}</span></div>
      <div className="pay-row"><span>مبلغ پیشنهادی شعبه</span><b>{finalizedAmount != null ? rial(finalizedAmount) : 'ثبت نشده'}</b></div>
      <div className="pay-row"><span>تایید مبلغ توسط ستاد</span><b>{info.amountApproval ? `تایید شد — ${info.amountApproval.by ?? ''} (${info.amountApproval.at})` : 'در انتظار تایید'}</b></div>
      {auths.length > 0 ? auths.slice(0, 3).map((a) => (
        <div key={a.id} className={`pay-auth is-${a.status.toLowerCase()}`}>
          <div><b>مجوز سرپرستی (حدود اختیار):</b> تا سقف {rial(a.ceiling)}</div>
          <div>برای: {a.grantee} — صادرکننده: {a.grantedBy ?? 'مدیریت ستاد'}{a.byCouncil ? ' (به دستور شورای فنی)' : ''} — {a.at}</div>
          <div>وضعیت: {a.statusLabel}{a.closedAt ? ` (${a.closedAt})` : ''}</div>
        </div>
      )) : <div className="text-xs" style={{ color: 'var(--muted)' }}>مجوز سرپرستی صادر نشده است.</div>}
      {list.length > 0 && (
        <div className="pay-cons">
          <b>فرم ارفاقی</b>
          {list.map((c) => (
            <div key={c.id} className="pay-con">
              {Object.keys(c.fields ?? {}).length === 0 && !c.section ? <span>— {c.details || 'بدون توضیح'} <span style={{ color: 'var(--muted)' }}>({c.at})</span></span> : (
                <>
                  <span>{c.statusLabel} <span style={{ color: 'var(--muted)' }}>({c.at})</span></span>
                  <button className={`ev-btn${c.section ? ' is-main' : ''}`} onClick={() => open(c)}>{c.section ? 'تکمیل فرم' : 'مشاهده فرم'}</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {info.canStartConcession && <button className="ev-btn w-full" disabled={busy} onClick={start}>فرم ارفاقی</button>}
      {error && !cur && <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>}
      {cur && (
        <PaperModal title="فرم گزارش خسارت ارفاقی" onClose={() => setOpenId(null)} actions={cur.section && (
          <>
            {error && <div className="w-full text-center text-sm font-bold" style={{ color: '#fecaca' }}>{error}</div>}
            <button className="btn btn-solid" disabled={busy} onClick={() => { if (window.confirm(`${SIGN_FA[cur.section!]}؟`)) run(() => client.post(`/claims/${claimId}/concessions/${cur.id}/sign`, { fields: draft }, 'org'), true); }}>{SIGN_FA[cur.section]}</button>
            <button className="btn" disabled={busy} onClick={() => run(() => client.put(`/claims/${claimId}/concessions/${cur.id}`, { fields: draft }, 'org'))}>ذخیره</button>
            {cur.section === 'BRANCH' && <button className="btn" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => { if (window.confirm('فرم ارفاقی حذف شود؟')) run(() => client.del(`/claims/${claimId}/concessions/${cur.id}`, 'org'), true); }}>حذف فرم</button>}
          </>
        )}>
          <ConcessionPaper values={cur.section ? draft : cur.fields} onChange={cur.section ? setDraft : undefined} section={cur.section} signs={cur.signatures ?? {}} />
        </PaperModal>
      )}
    </div>
  );
}
