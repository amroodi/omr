'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { client } from '../../../../lib/client';
import { Shell } from '../../../components/Shell';
import { ErrorBox, FancyLoader } from '../../../components/ui';
import { DocUploadTile } from '../../../components/upload';
import { ORG_NAV } from '../../nav';
import { CaseEditForm } from '../../claims/[id]/case-edit';

interface Doc { id: string; fileName: string }
interface Checklist { items: { code: string; label: string; required: boolean; documents: Doc[] }[]; otherDocuments: Doc[] }
interface SpareCase { id: string; number: number; claimTypeLabel: string; fullName: string | null; sharedCompanyName: string | null }

/** One case of «میز کار مستقل»: its documents and the same form as «ویرایش», with no hierarchy around it. */
export default function SpareCasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const base = `/spare/${id}`;
  const [c, setC] = useState<SpareCase | null>(null);
  const [list, setList] = useState<Checklist | null>(null);
  const [tab, setTab] = useState<'data' | 'docs'>('data');
  const [error, setError] = useState('');

  const loadCase = () => client.get<SpareCase>(base, 'org').then(setC).catch((e) => setError(e.message));
  const loadDocs = () => client.get<Checklist>(`${base}/checklist`, 'org').then(setList).catch((e) => setError(e.message));
  useEffect(() => { loadCase(); loadDocs(); /* eslint-disable-next-line */ }, [id]);

  const view = (d: Doc) => client.view(`${base}/documents/${d.id}/file`, 'org').catch((e) => setError(e.message));
  const removeDoc = async (d: Doc) => {
    if (!window.confirm(`«${d.fileName}» حذف شود؟`)) return;
    try { await client.del(`${base}/documents/${d.id}`, 'org'); await loadDocs(); } catch (e: any) { setError(e.message); }
  };
  const removeCase = async () => {
    if (!window.confirm('این پرونده از میز کار مستقل حذف شود؟')) return;
    try { await client.del(base, 'org'); router.push('/org/spare'); } catch (e: any) { setError(e.message); }
  };
  const files = (docs: Doc[]) => docs.map((d) => (
    <span key={d.id} className="flex items-center gap-2 text-xs mt-1">
      <button type="button" className="ce-link" onClick={() => view(d)}><bdi>{d.fileName}</bdi></button>
      <button type="button" style={{ color: 'var(--danger)' }} onClick={() => removeDoc(d)} aria-label={`حذف ${d.fileName}`}>✕</button>
    </span>
  ));

  return (
    <Shell title={c ? `پروندهٔ مستقل ${c.number.toLocaleString('fa-IR')}` : 'پروندهٔ مستقل'} breadcrumb="میز کار مستقل" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {!c ? (error ? null : <div className="pcard p-10 flex justify-center"><FancyLoader label="در حال دریافت پرونده" /></div>) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="inline-flex rounded-xl p-1 text-sm" style={{ background: 'var(--surface-2)' }}>
              <button onClick={() => setTab('data')} className={`btn btn-sm ${tab === 'data' ? 'btn-primary' : 'btn-ghost'}`}>اطلاعات پرونده</button>
              <button onClick={() => setTab('docs')} className={`btn btn-sm ${tab === 'docs' ? 'btn-primary' : 'btn-ghost'}`}>مدارک</button>
            </div>
            <span className="flex items-center gap-2 text-sm">
              <b>{c.claimTypeLabel}</b>
              {c.sharedCompanyName && <span className="badge badge-info">اشتراک با {c.sharedCompanyName}</span>}
              <button onClick={removeCase} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>حذف پرونده</button>
            </span>
          </div>
          {tab === 'data' ? <CaseEditForm claimId={id} base={base} title={c.fullName || c.claimTypeLabel} onSaved={loadCase} /> : (
            <div className="pcard p-5">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list?.items.map((it, i) => (
                  <div key={it.code} className="spare-doc">
                    <div className="spare-doc-t"><span className="doc-n">{(i + 1).toLocaleString('fa-IR')}</span>{it.label}{it.required && <span style={{ color: 'var(--danger)' }}> *</span>}</div>
                    <DocUploadTile label={it.label} required={it.required} uploaded={it.documents.length > 0} compact
                      onUpload={async (file, onP) => { const fd = new FormData(); fd.append('file', file); await client.upload(`${base}/documents?docCode=${encodeURIComponent(it.code)}`, fd, 'org', onP); await loadDocs(); }} />
                    {files(it.documents)}
                  </div>
                ))}
              </div>
              {!!list?.otherDocuments.length && <div className="mt-3 text-sm"><b>سایر مدارک</b>{files(list.otherDocuments)}</div>}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
