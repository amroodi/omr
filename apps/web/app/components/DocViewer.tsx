'use client';
import { useEffect, useState } from 'react';
import { client } from '../../lib/client';
import { Icon } from './Shell';
import { Spinner } from './ui';

/** One document rendered inline (image scaled by zoom, or PDF in an embed). */
export function DocMedia({ claimId, docId, fileName, zoom }: { claimId: string; docId: string; fileName: string; zoom: number }) {
  const [src, setSrc] = useState<{ url: string; mimeType: string } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let active = true; let u: string | null = null;
    client.blobUrl(`/claims/${claimId}/documents/${docId}/file`, 'org')
      .then((r) => { if (active) { setSrc(r); u = r.url; } else URL.revokeObjectURL(r.url); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; if (u) URL.revokeObjectURL(u); };
  }, [claimId, docId]);
  if (err) return <div className="text-xs py-4 text-center" style={{ color: 'var(--danger)' }}>خطا در بارگذاری سند</div>;
  if (!src) return <div className="py-8 flex justify-center"><Spinner /></div>;
  if (src.mimeType === 'application/pdf') return <iframe className="assess-doc-pdf" src={src.url} title={fileName} />;
  return <ImageViewer url={src.url} fileName={fileName} baseZoom={zoom} />;
}

/**
 * Images get the same kind of toolbar the browser gives PDFs: rotate, zoom out/in with the percent,
 * fit to width, download, print and open full size. Each document keeps its own zoom and rotation.
 */
export function ImageViewer({ url, fileName, baseZoom }: { url: string; fileName: string; baseZoom: number }) {
  const [zoom, setZoom] = useState(baseZoom);
  const [rot, setRot] = useState(0);
  useEffect(() => { setZoom(baseZoom); }, [baseZoom]); // the pane's −/+ still zooms every image
  const sideways = rot % 180 !== 0;
  const download = () => { const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html dir="rtl"><head><title>${fileName.replace(/</g, '')}</title></head><body style="margin:0;display:flex;justify-content:center"><img src="${url}" style="max-width:100%;transform:rotate(${rot}deg)" onload="window.print()"></body></html>`);
    w.document.close();
  };
  const B = ({ title, onClick, path, label }: { title: string; onClick: () => void; path?: string; label?: string }) => (
    <button type="button" className="iv-btn" title={title} aria-label={title} onClick={onClick}>{path ? <Icon path={path} /> : label}</button>
  );
  return (
    <div className="iv">
      <div className="iv-bar">
        <B title="چرخش به چپ" onClick={() => setRot((r) => (r + 270) % 360)} path="M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10" />
        <B title="چرخش به راست" onClick={() => setRot((r) => (r + 90) % 360)} path="M23 4v6h-6M20.49 15a9 9 0 11-2.12-9.36L23 10" />
        <span className="iv-sep" />
        <B title="کوچک‌تر" onClick={() => setZoom((z) => Math.max(25, z - 15))} label="−" />
        <span className="iv-pct">{zoom.toLocaleString('fa-IR')}٪</span>
        <B title="بزرگ‌تر" onClick={() => setZoom((z) => Math.min(400, z + 15))} label="+" />
        <B title="اندازهٔ صفحه" onClick={() => { setZoom(100); setRot(0); }} path="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
        <span className="iv-grow" />
        <B title="دریافت فایل" onClick={download} path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        <B title="چاپ" onClick={print} path="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" />
        <B title="باز کردن در اندازهٔ کامل" onClick={() => window.open(url, '_blank')} path="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
      </div>
      <div className="iv-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className="iv-img" style={{ width: `${zoom}%`, transform: `rotate(${rot}deg)`, margin: sideways ? '18% 0' : undefined }} />
      </div>
    </div>
  );
}
