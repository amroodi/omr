'use client';
import { Attention } from './WorkflowPanel';

/**
 * «موارد نیازمند توجه»: what waits for this user on the case (requests to them) and why an action of theirs
 * is blocked — at the top of the case, so nothing has to be hunted for. `onFix` opens where it is fixed.
 */
export function AttentionBox({ items, onFix }: { items?: Attention[]; onFix?: (fix: NonNullable<Attention['fix']>) => void }) {
  if (!items?.length) return null;
  const FIX: Record<string, string> = { HEIRS: 'تطابق ذینفعان', DOCS: 'مدارک', PHYSICAL: 'اصل مدارک' };
  return (
    <div className="att-box no-print" role="status">
      <div className="att-h">موارد نیازمند توجه</div>
      <ul>
        {items.map((a, i) => (
          <li key={i} className={a.kind === 'BLOCKER' ? 'is-block' : 'is-req'}>
            <span>{a.text}</span>
            {a.fix && onFix && <button type="button" className="att-fix" onClick={() => onFix(a.fix!)}>{FIX[a.fix]}</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
