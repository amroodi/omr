'use client';
import { useEffect, useState } from 'react';
import { client } from '../../../lib/client';
import { OrgNav } from '../nav';

const card = { background: 'var(--card)', borderColor: 'var(--border)' };

interface Doc {
  id: string;
  kind: string;
  fileName: string;
  verificationStatus: string;
  caseId: string | null;
}

export default function AssessorQueue() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});

  const load = () =>
    client.get<Doc[]>('/documents/verification-queue', 'org').then(setDocs).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, status: string) => {
    setError('');
    try {
      await client.post(`/documents/${id}/verify`, { status, note: note[id] || undefined }, 'org');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <OrgNav />
      <h1 className="text-lg font-bold mb-3">صف ارزیابی اصالت مدارک</h1>
      {error && <div className="rounded-lg border p-2 text-sm mb-2" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      {docs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>موردی برای ارزیابی نیست.</p>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <div key={d.id} className="rounded-xl border p-3 space-y-2" style={card}>
              <div className="flex justify-between text-sm">
                <span>{d.fileName}</span>
                <span style={{ color: 'var(--muted)' }}>{d.kind}</span>
              </div>
              <input
                value={note[d.id] || ''}
                onChange={(e) => setNote({ ...note, [d.id]: e.target.value })}
                placeholder="یادداشت / یافته‌ها (اختیاری)"
                className="w-full rounded-lg border p-2 bg-transparent text-sm"
                style={{ borderColor: 'var(--border)' }}
              />
              <div className="flex gap-2">
                <button onClick={() => decide(d.id, 'VERIFIED')} className="rounded-lg px-3 py-1 text-sm text-white" style={{ background: '#10b981' }}>تایید اصالت</button>
                <button onClick={() => decide(d.id, 'REJECTED')} className="rounded-lg px-3 py-1 text-sm text-white" style={{ background: '#ef4444' }}>رد</button>
                <button onClick={() => decide(d.id, 'NEEDS_INFO')} className="rounded-lg px-3 py-1 text-sm text-white" style={{ background: '#f59e0b' }}>نیاز به اطلاعات</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
