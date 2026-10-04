'use client';
import { useEffect, useState } from 'react';
import { client, Realm } from '../../../../lib/client';

interface FieldRow {
  key: string; label: string; type: string; options: string[];
  required: boolean; value: string | null; source: string | null;
  confidence: number | null; confirmed: boolean; canEdit: boolean;
}
interface FieldsData { party: string; groups: Record<string, FieldRow[]> }

const GROUP_LABELS: Record<string, string> = {
  CLAIM_DATA: 'اطلاعات پرونده و بیمه‌نامه',
  BENEFICIARY: 'ذینفع',
  WORKFLOW_STAGE: 'مراحل و وضعیت گردش کار',
};

export function FieldsSection({ claimId, realm, basePath }: { claimId: string; realm: Realm; basePath: string }) {
  const [data, setData] = useState<FieldsData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { t: 'ok' | 'err'; m: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => client.get<FieldsData>(`${basePath}/${claimId}/fields`, realm).then((d) => {
    setData(d);
    const dr: Record<string, string> = {};
    Object.values(d.groups).flat().forEach((f) => { dr[f.key] = f.value ?? ''; });
    setDrafts(dr);
  }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [claimId]);

  const save = async (f: FieldRow) => {
    if (!f.canEdit || drafts[f.key] === (f.value ?? '')) return;
    setBusy(f.key); setMsg((m) => ({ ...m, [f.key]: undefined as any }));
    try {
      await client.put(`${basePath}/${claimId}/fields/${f.key}`, { value: drafts[f.key] }, realm);
      setMsg((m) => ({ ...m, [f.key]: { t: 'ok', m: 'ذخیره شد' } }));
      load();
    } catch (e: any) { setMsg((m) => ({ ...m, [f.key]: { t: 'err', m: e.message } })); } finally { setBusy(null); }
  };
  const confirm = async (f: FieldRow) => {
    setBusy(f.key);
    try { await client.post(`${basePath}/${claimId}/fields/${f.key}/confirm`, {}, realm); load(); }
    catch (e: any) { setMsg((m) => ({ ...m, [f.key]: { t: 'err', m: e.message } })); } finally { setBusy(null); }
  };

  if (!data) return null;
  return (
    <div className="space-y-4">
      {Object.entries(data.groups).map(([group, fields]) => fields.length === 0 ? null : (
        <div key={group} className="card p-5">
          <h3 className="font-bold mb-3">{GROUP_LABELS[group] || group}</h3>
          <div className="grid md:grid-cols-2 gap-x-5 gap-y-3">
            {fields.map((f) => {
              const isOcrDraft = f.source === 'OCR' && !f.confirmed;
              const borderColor = isOcrDraft ? 'var(--warning)' : f.confirmed ? 'var(--success)' : 'var(--border-strong)';
              return (
                <div key={f.key}>
                  <label className="label flex items-center justify-between">
                    <span>{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
                    {isOcrDraft && <span className="badge badge-warning">OCR {f.confidence != null ? `${Math.round(f.confidence * 100)}٪` : ''}</span>}
                    {f.confirmed && f.value && <span style={{ color: 'var(--success)' }}>✔</span>}
                  </label>
                  {f.type === 'SELECT' ? (
                    <select className="input" value={drafts[f.key] ?? ''} disabled={!f.canEdit || busy === f.key} onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })} onBlur={() => save(f)} style={{ borderColor }}>
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input className="input" value={drafts[f.key] ?? ''} disabled={!f.canEdit || busy === f.key}
                      onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })} onBlur={() => save(f)}
                      placeholder={f.type === 'DATE' ? '۱۴۰۵/۰۷/۰۱' : ''}
                      style={{ borderColor, direction: ['AMOUNT', 'NUMBER', 'NATIONAL_CODE', 'IBAN', 'DATE'].includes(f.type) ? 'ltr' : 'rtl', textAlign: 'right' }} />
                  )}
                  <div className="flex items-center gap-2 mt-1 min-h-[18px]">
                    {msg[f.key] && <span className="text-xs" style={{ color: msg[f.key].t === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg[f.key].m}</span>}
                    {isOcrDraft && f.canEdit && <button onClick={() => confirm(f)} disabled={busy === f.key} className="text-xs" style={{ color: 'var(--brand)' }}>تایید مقدار OCR</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
