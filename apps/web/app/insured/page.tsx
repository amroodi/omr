'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { client, getToken, signOut } from '../../lib/client';
import { claimTypeLabel, Spinner } from '../components/ui';
import { OnProgress, UploadButton } from '../components/upload';

interface InsuredDoc { code: string; label: string; fileName: string | null; state: 'MISSING' | 'SENT' | 'APPROVED' | 'REFUSED'; reason: string | null }
interface InsuredCase { id: string; claimNumber: string; claimType: string; closed: boolean; where: string; documents: InsuredDoc[] }

const STATE: Record<InsuredDoc['state'], { text: string; color: string }> = {
  MISSING: { text: 'هنوز بارگذاری نشده است', color: 'var(--muted)' },
  SENT: { text: 'ارسال شد؛ در دست بررسی', color: 'var(--text)' },
  APPROVED: { text: 'تایید شد', color: 'var(--success)' },
  REFUSED: { text: 'رد شد؛ مدرک درست را دوباره بارگذاری کنید', color: 'var(--danger)' },
};

/** «پنل بیمه‌شده»: the invited cases and only this person's documents. */
export default function InsuredPanel() {
  const router = useRouter();
  const [cases, setCases] = useState<InsuredCase[] | null>(null);
  const [error, setError] = useState('');
  const load = () => client.get<InsuredCase[]>('/insured/cases', 'insured').then(setCases).catch((e) => { setCases([]); setError(e.message); });
  useEffect(() => {
    if (!getToken('insured')) { router.replace('/insured/login'); return; }
    client.get<{ enabled: boolean }>('/insured/status').then((s) => { if (s.enabled) load(); else { signOut('insured'); router.replace('/'); } }).catch((e) => setError(e.message));
    // eslint-disable-next-line
  }, []);
  const upload = async (c: InsuredCase, code: string, file: File, onP: OnProgress) => {
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/insured/cases/${c.id}/documents?docCode=${encodeURIComponent(code)}`, fd, 'insured', onP);
    await load();
  };

  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold">پنل بیمه‌شده</h1>
          <button className="btn btn-ghost btn-sm" onClick={() => { signOut('insured'); router.replace('/insured/login'); }}>خروج</button>
        </div>
        {error && <div className="alert-error">{error}</div>}
        {!cases ? <div className="card p-8 text-center"><Spinner /></div>
          : cases.length === 0 ? <div className="card p-6 text-sm">پرونده‌ای برای این شماره فعال نیست.</div>
          : cases.map((c) => (
            <div key={c.id} className="card p-4 space-y-3">
              <div>
                <div className="font-extrabold">پروندهٔ {c.claimNumber}</div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>{claimTypeLabel(c)} — وضعیت: {c.where}</div>
              </div>
              {c.documents.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>مدرکی برای بارگذاری شما تعریف نشده است.</p>}
              {c.documents.map((d) => (
                <div key={d.code} className="p-3 rounded-lg space-y-2" style={{ border: '1px solid var(--border)' }}>
                  <div className="text-sm font-bold">{d.label}</div>
                  <div className="text-xs" style={{ color: STATE[d.state].color }}>{STATE[d.state].text}{d.fileName ? <> — <bdi>{d.fileName}</bdi></> : null}</div>
                  {d.reason && <div className="text-xs" style={{ color: 'var(--danger)' }}>{d.reason}</div>}
                  {!c.closed && d.state !== 'APPROVED' && (
                    <UploadButton className="btn btn-primary btn-sm" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera title="بارگذاری مدرک" subtitle={d.label} onUpload={(f, onP) => upload(c, d.code, f, onP)}>
                      {d.state === 'MISSING' ? 'بارگذاری مدرک' : 'بارگذاری دوباره'}
                    </UploadButton>
                  )}
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
