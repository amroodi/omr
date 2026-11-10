'use client';
import { useEffect, useState } from 'react';
import { client } from '../../lib/client';
import { JalaliDatePicker } from './JalaliDatePicker';
import type { FieldsData, FieldRow } from './case-ui';

const KEY = 'death_notice_date';

/**
 * «تاریخ اعلام فوت»: when the death-notice letter (usually the case's first document) reached us. Never typed
 * at filing; panel 2 sets it wherever it sees the case. The server decides who may: on a کارگزاری's case only
 * that کارگزاری's panel 2, on the insurer's own case the operator who holds it on their desk. Others see it.
 */
export function DeathNoticeDate({ claimId, className = '' }: { claimId: string; className?: string }) {
  const [row, setRow] = useState<FieldRow | null>(null);
  const [v, setV] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => client.get<FieldsData>(`/claims/${claimId}/fields`, 'org').then((d) => {
    const f = Object.values(d.groups).flat().find((x) => x.key === KEY) ?? null;
    setRow(f); setV(f?.value ?? '');
  }).catch(() => setRow(null));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [claimId]);

  if (!row) return null;
  const save = async () => {
    setBusy(true); setErr('');
    try { await client.put(`/claims/${claimId}/fields/${KEY}`, { value: v }, 'org'); setEditing(false); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className={`dnd ${className}`}>
      <span className="dnd-l">تاریخ اعلام فوت:</span>
      {editing ? (
        <>
          <span className="dnd-pick"><JalaliDatePicker value={v} onChange={setV} placeholder="۱۴۰۵/۰۸/۰۱" /></span>
          <button type="button" className="dnd-btn" disabled={busy || !v} onClick={save}>{busy ? '…' : 'ثبت'}</button>
          <button type="button" className="dnd-btn is-ghost" disabled={busy} onClick={() => { setEditing(false); setV(row.value ?? ''); setErr(''); }}>انصراف</button>
        </>
      ) : (
        <>
          <b>{row.value || 'ثبت نشده'}</b>
          {row.canEdit && <button type="button" className="dnd-btn is-ghost" onClick={() => setEditing(true)}>{row.value ? 'ویرایش' : 'ثبت تاریخ'}</button>}
        </>
      )}
      {err && <span className="dnd-err">{err}</span>}
    </div>
  );
}
