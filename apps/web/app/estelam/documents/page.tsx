'use client';
import { Icon } from '../../components/Shell';
import { EstelamFrame, SubHead } from '../shared';

const DESK_FA: Record<string, string> = { BROKER: 'کارگزاری', BRANCH: 'شعبه', HQ: 'ستاد', COUNCIL: 'شورای فنی' };
const OK = 'M20 6L9 17l-5-5';
const NO = 'M18 6L6 18M6 6l12 12';
const faN = (n: number) => n.toLocaleString('fa-IR');

interface DocRow { label: string; uploaded: boolean; uploadedAt: string | null; verified: boolean; reviews: { stage: string; state: string; at: string | null }[] }

/** ✓ / ✕ disc: green approved, red rejected, pale while not decided yet (as on the org page). */
function Mark({ state, title }: { state: 'ok' | 'no' | 'wait'; title: string }) {
  return <span className={`cs-mark is-${state === 'ok' ? 'ok' : state === 'no' ? 'no' : 'pending'}`} title={title}><Icon path={state === 'ok' ? OK : NO} /></span>;
}

/**
 * «بررسی وضعیت مدارک» for the inquiry: every required document, whether it's uploaded, and each desk's
 * decision — the same table as the org page, read-only and without the files. A hand-completed case
 * («ویرایش») shows uploads only.
 */
export default function EstelamDocuments() {
  return (
    <EstelamFrame>
      {(r) => {
        const docs: DocRow[] = r.documents ?? [];
        const manual = !!r.story?.manual;
        const seen = new Set<string>();
        docs.forEach((d) => d.reviews.forEach((x) => seen.add(x.stage)));
        const order = ['BROKER', 'BRANCH', 'HQ', 'COUNCIL'];
        const desks = manual ? [] : order.filter((s) => seen.has(s)).length ? order.filter((s) => seen.has(s)) : ['BROKER', 'BRANCH', 'HQ'];
        return (
          <>
            <SubHead title="بررسی وضعیت مدارک" icon="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5" />
            {docs.length === 0 ? (
              <div className="est-card p-6 text-sm" style={{ color: 'var(--muted)' }}>فهرست مدارک این پرونده هنوز در دسترس نیست.</div>
            ) : (
              <section className="cs-table">
                <div className="cs-table-h cs-grid-docs" style={{ ['--desks' as any]: desks.length }}>
                  <span className="cs-th-n" />
                  <span>بارگذاری</span>
                  {desks.map((s) => <span key={s}>{DESK_FA[s]}</span>)}
                  <span className="cs-th-doc">وضعیت</span>
                </div>
                <div className="cs-table-b">
                  {docs.map((d, i) => (
                    <div key={i} className={`cs-tr cs-grid-docs${d.verified ? ' is-done' : ''}`} style={{ ['--desks' as any]: desks.length }}>
                      <span className="cs-td-n">{faN(i + 1)}</span>
                      <span className="cs-td-up"><Mark state={d.uploaded ? 'ok' : 'no'} title={d.uploaded ? `بارگذاری شده — ${d.uploadedAt ?? ''}` : 'بارگذاری نشده'} /></span>
                      {desks.map((s) => {
                        const rv = d.reviews.find((x) => x.stage === s);
                        const st = rv?.state === 'APPROVED' ? 'ok' : rv?.state === 'REJECTED' ? 'no' : 'wait';
                        return <span key={s} className="cs-td-desk"><Mark state={d.uploaded ? st : 'wait'} title={`${DESK_FA[s]}: ${!d.uploaded ? 'بارگذاری نشده' : st === 'ok' ? 'تایید' : st === 'no' ? 'رد' : 'در انتظار بررسی'}${rv?.at && st !== 'wait' ? ` — ${rv.at}` : ''}`} /></span>;
                      })}
                      <span className="cs-td-doc">{d.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        );
      }}
    </EstelamFrame>
  );
}
