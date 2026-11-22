'use client';
import { useRef, useState } from 'react';
import { downloadBrandedPdf } from '../../lib/pdf';
import { Checklist } from './case-ui';
import { BEN_FA } from './heirs';

/**
 * «دانلود فهرست مدارک»: the documents this case needs (not the uploaded files), on the letterhead, to print and
 * gather on paper. «تصویر مدارک ذینفع/ذینفعان» lists the documents of each of its three choices.
 */
export function RequiredDocsButton({ checklist, title, kind, insurer }: { checklist: Checklist; title: string; kind: string | null; insurer: string | null }) {
  const sheet = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const ben = checklist.beneficiary ?? null;
  const plain = checklist.items.filter((it) => it.group !== 'BENEFICIARY' && it.group !== 'EMPLOYMENT' && !it.insurerOnly && !it.deficiency?.custom);
  const emp = checklist.employment ?? null;
  const rows: { label: string; required: boolean; sub?: { head: string; docs: string[] }[] }[] = plain.map((it) => ({ label: it.label, required: !!it.required }));
  // later position first, so the earlier one's index still holds
  const groups = [
    ...(emp ? [{ at: emp.at, order: emp.order ?? Number.MAX_SAFE_INTEGER, row: { label: emp.label, required: true, sub: (emp.options ?? []).filter((o) => o.type !== 'RETIRED' || emp.retired).map((o) => ({ head: o.type === 'RETIRED' ? 'بازنشسته' : 'شاغلین', docs: o.docs })) } }] : []),
    ...(ben ? [{ at: ben.at, order: ben.order ?? -1, row: { label: ben.label, required: true, sub: (ben.options ?? []).map((o) => ({ head: BEN_FA[o.type] ?? o.type, docs: o.docs })) } }] : []),
  ].sort((a, b) => b.at - a.at || b.order - a.order); // at the same place, by their slots' order
  for (const g of groups) rows.splice(Math.min(g.at, rows.length), 0, g.row);
  const run = async () => {
    if (!sheet.current) return;
    setBusy(true);
    try {
      await downloadBrandedPdf(sheet.current, `required-documents-${title}`.replace(/\s+/g, '-'), {
        title: 'فهرست مدارک مورد نیاز',
        meta: [{ label: 'نوع پرونده', value: title }, ...(kind ? [{ label: 'نوع بیمه‌نامه', value: kind }] : []), ...(insurer ? [{ label: 'بیمه‌گر', value: insurer }] : [])],
      });
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm no-print" onClick={run} disabled={busy}>{busy ? '…' : 'دانلود فهرست مدارک'}</button>
      {/* The sheet that goes on paper: laid out off screen. */}
      <div aria-hidden style={{ position: 'fixed', top: 0, left: -10000, width: 900, pointerEvents: 'none' }}>
        <div ref={sheet} className="rq-sheet" dir="rtl">
          <table>
            <thead><tr><th style={{ width: 50 }}>ردیف</th><th>عنوان مدرک</th><th style={{ width: 90 }}>الزامی</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{(i + 1).toLocaleString('fa-IR')}</td>
                  <td>
                    {r.label}
                    {r.sub && r.sub.map((s) => (
                      <div key={s.head} className="rq-sub"><b>{s.head}:</b>{s.docs.length ? <ul>{s.docs.map((d) => <li key={d}>{d}</li>)}</ul> : <span> —</span>}</div>
                    ))}
                  </td>
                  <td>{r.required ? 'الزامی' : 'برحسب نیاز'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(checklist.tips ?? []).length > 0 && <ul className="rq-tips">{checklist.tips!.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
      </div>
    </>
  );
}
