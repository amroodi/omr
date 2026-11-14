'use client';
import { useState } from 'react';
import { client } from '../../lib/client';

/** What panel 2 is told about a case's payment (see the API's paymentView). */
export interface PaymentInfo {
  amountApproval?: { at: string; by: string | null } | null;
  paymentAuthorities?: { id: string; ceiling: string; status: string; statusLabel: string; grantee: string; grantedBy: string | null; byCouncil: boolean; at: string; closedAt: string | null; note: string | null }[];
  concessions?: { id: string; details: string | null; by: string | null; at: string }[];
  myStage?: string | null;
}

const rial = (v: string | number) => `${Number(v).toLocaleString('fa-IR')} ریال`;

/**
 * «تایید مبلغ، مجوز سرپرستی و فرم ارفاقی»: whether ستاد approved شعبه's amount, the مجوز سرپرستی (حدود اختیار)
 * ستاد gave for this case (to whom, up to how much, and whether it was used), and ستاد's «فرم ارفاقی» — which
 * ستاد adds right here.
 */
export function PaymentBox({ claimId, info, finalizedAmount, closed, onDone }: { claimId: string; info: PaymentInfo; finalizedAmount?: string | null; closed?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auths = info.paymentAuthorities ?? [];
  const active = auths.find((a) => a.status === 'ACTIVE');
  const hq = info.myStage === 'HQ';
  const save = async () => {
    setBusy(true); setError('');
    try { await client.post(`/claims/${claimId}/concessions`, { details: details.trim() || undefined }, 'org'); setOpen(false); setDetails(''); onDone(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
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
      {(info.concessions ?? []).length > 0 && (
        <div className="pay-cons">
          <b>فرم ارفاقی</b>
          {info.concessions!.map((c) => <div key={c.id}>— {c.details || 'بدون توضیح'} <span style={{ color: 'var(--muted)' }}>({c.by ?? 'ستاد'}، {c.at})</span></div>)}
        </div>
      )}
      {hq && !closed && (open ? (
        <div className="space-y-2">
          <textarea className="input" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="توضیحات فرم ارفاقی (اختیاری) — برای موارد خاص و استثنا" />
          {error && <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="flex gap-2">
            <button className="ev-btn is-main" disabled={busy} onClick={save}>ثبت فرم ارفاقی</button>
            <button className="ev-btn" disabled={busy} onClick={() => setOpen(false)}>انصراف</button>
          </div>
        </div>
      ) : <button className="ev-btn w-full" onClick={() => setOpen(true)}>صدور فرم ارفاقی برای شعبه</button>)}
    </div>
  );
}
