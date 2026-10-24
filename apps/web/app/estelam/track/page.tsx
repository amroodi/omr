'use client';
import { ACTION_FA, EstelamFrame, PANELS, STATE_FA, SubHead, phaseText } from '../shared';

/** پیگیری آخرین وضعیت — where the case is now, the chain, open deficiencies and every hand-off. */
export default function EstelamTrack() {
  return (
    <EstelamFrame>
      {(r) => {
        const cur = r.chain?.findIndex((c: any) => c.stage === r.currentStage) ?? -1;
        const openDefs = (r.deficiencies ?? []).filter((d: any) => !d.resolvedAt);
        return (
          <>
            <SubHead title={PANELS[0].label} icon={PANELS[0].icon} />
            <div className="est-card p-5 space-y-5">
              <div className="est-pill est-pill-light"><span className="est-pill-dot" />{phaseText(r)}</div>
              {r.chain && (
                <div className="est-chain">
                  {r.chain.map((c: any, i: number) => (
                    <span key={c.stage} className={`est-chain-i${c.stage === r.currentStage ? ' is-cur' : i < cur && r.flowDirection === 'UP' ? ' is-done' : ''}`}>{c.label}</span>
                  ))}
                </div>
              )}
              {r.physicalAtLabel && <div className="text-sm">محل نگهداری اصل مدارک: <b>{r.physicalAtLabel}</b></div>}
              {openDefs.length > 0 && (
                <div className="text-sm rounded-xl p-3" style={{ background: 'var(--danger-soft)' }}>
                  <b>نقص‌های اعلام‌شده:</b>
                  <ul className="list-disc mr-5 mt-1">{openDefs.flatMap((d: any) => d.items).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
              <ol className="est-steps">
                {(r.steps ?? []).map((s: any) => (
                  <li key={s.order} className={s.state === 'PENDING' ? 'is-pending' : ''}>
                    <span className="n">{Number(s.order).toLocaleString('fa-IR')}</span>
                    <span><b>{s.stageLabel || '—'}</b>: {s.state === 'PENDING' ? 'در انتظار اقدام' : ACTION_FA[s.action] || STATE_FA[s.state] || 'انجام شد'}{s.decidedAt ? <span style={{ color: 'var(--muted)' }}> — {s.decidedAt}</span> : null}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        );
      }}
    </EstelamFrame>
  );
}
