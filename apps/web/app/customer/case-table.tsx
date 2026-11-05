'use client';
import Link from 'next/link';
import { claimTypeLabel, STATUS_MAP } from '../components/ui';
import { INSURED_RELATIONS } from '../components/claim-wording';

export interface MyClaim {
  id: string; claimNumber: string; policyNumber?: string | null; status: string; claimType: string; claimTypeLabel?: string | null; deceasedName: string | null; deceasedNationalCode?: string | null;
  needsAction: boolean; currentStageLabel?: string | null; eventDate?: string | null; createdAt?: string | null;
  claimedAmount?: string; payableAmount?: string; finalizedAmount?: string | null; policyholderCompanyId?: string | null;
  insuredRelation?: string | null; policyStart?: string | null; policyEnd?: string | null;
}

const faN = (n: number) => n.toLocaleString('fa-IR');

/** The table of cases on «پیگیری خسارت», «نیازمند اقدام» and the پیشخوان's search (`href`: panel 1 of an organization). */
export function CaseTable({ rows, href = (id) => `/customer/claims/${id}/workflow` }: { rows: MyClaim[]; href?: (id: string) => string }) {
  const relations = rows.some((c) => c.insuredRelation);
  const heads = ['عملیات', 'شماره پرونده', 'بیمه‌شده', 'کد ملی', ...(relations ? ['نسبت'] : []), 'نوع خسارت', 'بازهٔ بیمه‌نامه', 'تاریخ وقوع', 'مبلغ برآوردی (ریال)', 'مبلغ قابل پرداخت (ریال)', 'وضعیت پرونده'];
  return (
    <div className="overflow-x-auto">
      <table className="table cu-group-t">
        <thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={c.status === 'PAID' ? 'is-paid' : c.status === 'REJECTED' ? 'is-rejected' : undefined}>
              <td><Link href={href(c.id)} target="_blank" rel="noopener" className="cu-more">جزئیات بیشتر</Link></td>
              <td className="latin-digits" style={{ whiteSpace: 'nowrap' }}>{c.claimNumber}</td>
              <td>{c.deceasedName ?? '—'}</td>
              <td className="latin-digits" style={{ whiteSpace: 'nowrap' }}>{c.deceasedNationalCode ?? '—'}</td>
              {relations && <td>{INSURED_RELATIONS[c.insuredRelation ?? 'MAIN']}</td>}
              <td>{claimTypeLabel(c)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{c.policyStart || c.policyEnd ? `${c.policyStart ?? '…'} تا ${c.policyEnd ?? '…'}` : '—'}</td>
              <td>{c.eventDate ?? '—'}</td>
              <td>{faN(Number(c.claimedAmount || 0))}</td>
              <td>{c.finalizedAmount ? faN(Number(c.finalizedAmount)) : '—'}</td>
              <td>{STATUS_MAP[c.status]?.label ?? c.status}{c.currentStageLabel ? ` — نزد ${c.currentStageLabel}` : ''}{c.needsAction ? ' (نیازمند اقدام شما)' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
