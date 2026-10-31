'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { client } from '../../../lib/client';
import { FancyLoader } from '../../components/ui';
import { OnProgress, UploadButton } from '../../components/upload';

interface LinkInfo {
  claimNumber: string; archived: boolean; expiresAt: string; checking: number;
  items: { code: string; label: string; reason: string | null }[];
}

/**
 * «بارگذاری دوبارهٔ مدارک» — opened from the SMS sent when the AI refused files. No login: the link
 * shows only this case's refused documents and takes a new file for each.
 */
export default function FixDocuments() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(0);

  const load = () => client.get<LinkInfo>(`/upload-link/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const upload = async (code: string, file: File, onProgress: OnProgress) => {
    const fd = new FormData(); fd.append('file', file);
    await client.upload(`/upload-link/${encodeURIComponent(token)}/documents?docCode=${encodeURIComponent(code)}`, fd, undefined, onProgress);
    setSent((n) => n + 1);
    await load();
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="card p-5 space-y-4 w-full" style={{ maxWidth: 560, marginTop: 32 }}>
        <h1 className="text-xl font-extrabold">بارگذاری دوبارهٔ مدارک</h1>
        {error ? <div className="alert-error">{error}</div> : !info ? <div className="flex justify-center p-8"><FancyLoader label="در حال بارگذاری" /></div> : (
          <>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>پروندهٔ {info.claimNumber}</p>
            {info.archived ? <div className="alert-success">این پرونده بسته شده است و نیازی به بارگذاری ندارد.</div> : (
              <>
                {sent > 0 && <div className="alert-success text-sm">مدرک دریافت شد و دوباره بررسی می‌شود. نتیجه با پیامک به شما اعلام می‌شود.</div>}
                {info.items.length === 0 ? (
                  <div className="alert-success text-sm">
                    {info.checking > 0 ? 'مدارک شما در حال بررسی است؛ نتیجه با پیامک اعلام می‌شود.' : 'همهٔ مدارک در جای درست بارگذاری شده است و کاری لازم نیست.'}
                  </div>
                ) : (
                  <>
                    <p className="text-sm">مدارک زیر در جای درست بارگذاری نشده بود. برای هر کدام، همان مدرکی را که عنوانش آمده است بارگذاری کنید:</p>
                    <div className="space-y-3">
                      {info.items.map((it) => (
                        <div key={it.code} className="p-3 rounded-lg space-y-2" style={{ border: '1px solid var(--border)' }}>
                          <div className="text-sm font-bold">{it.label}</div>
                          {it.reason && <div className="text-xs" style={{ color: 'var(--danger)' }}>{it.reason}</div>}
                          <UploadButton className="btn btn-primary btn-sm" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" maxMB={15} camera
                            title="بارگذاری مدرک" subtitle={it.label} onUpload={(f, onP) => upload(it.code, f, onP)}>
                            بارگذاری مدرک
                          </UploadButton>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <p className="text-xs" style={{ color: 'var(--muted)' }}>این پیوند تا {info.expiresAt} معتبر است.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
