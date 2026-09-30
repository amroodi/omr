'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { Shell } from '../../components/Shell';
import { ErrorBox } from '../../components/ui';
import { ORG_NAV } from '../nav';

interface Doc { id: string; kind: string; fileName: string; verificationStatus: string; caseId: string | null }

export default function AssessorQueue() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});

  const load = () => client.get<Doc[]>('/documents/verification-queue', 'org').then(setDocs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const decide = async (id: string, status: string) => {
    setError('');
    try { await client.post(`/documents/${id}/verify`, { status, note: note[id] || undefined }, 'org'); load(); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <Shell title="ارزیابی اصالت مدارک" subtitle="بررسی صحت و اصالت اسناد بارگذاری‌شده" nav={ORG_NAV} realm="org">
      <ErrorBox message={error} />
      {docs.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
          موردی برای ارزیابی در صف نیست.
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <div key={d.id} className="card p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold">{d.fileName}</span>
                <span className="badge badge-neutral">{d.kind}</span>
              </div>
              <input value={note[d.id] || ''} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} placeholder="یادداشت یا یافته‌ها (اختیاری)" className="input" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => decide(d.id, 'VERIFIED')} className="btn btn-sm" style={{ background: 'var(--success)', color: '#fff' }}>تایید اصالت</button>
                <button onClick={() => decide(d.id, 'REJECTED')} className="btn btn-sm" style={{ background: 'var(--danger)', color: '#fff' }}>رد</button>
                <button onClick={() => decide(d.id, 'NEEDS_INFO')} className="btn btn-sm" style={{ background: 'var(--warning)', color: '#fff' }}>نیاز به اطلاعات</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
