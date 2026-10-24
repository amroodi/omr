'use client';
import { useEffect, useState, type CSSProperties } from 'react';

/** Backdrop picked for a logo: its own corner colour when it has one, otherwise light or dark by its ink. */
type Look = { bg: string; pad: boolean };
const cache = new Map<string, Look>();

function analyse(img: HTMLImageElement): Look | null {
  try {
    const w = 48, h = Math.max(1, Math.round((48 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const px = (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    // Opaque corners → the logo brings its own background: reuse it so the tile blends with the artwork.
    if (corners.every((p) => p[3] > 230)) {
      const avg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, p) => s + p[k], 0) / 4));
      return { bg: `rgb(${avg.join(',')})`, pad: false };
    }
    // Transparent logo → judge the ink: dark ink sits on light, light ink on dark.
    let lum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
    }
    if (!n) return null;
    return lum / n > 170 ? { bg: '#1e293b', pad: true } : { bg: '#ffffff', pad: true };
  } catch { return null; } // tainted canvas (no CORS) — keep the neutral look
}

/**
 * A logo inside a tile whose background suits the logo (instead of always white).
 * `size` is the tile edge in px; `round` makes it a circle. Extra style goes on the tile.
 */
export function LogoTile({ src, size, round, style, className, alt = '' }: { src: string; size?: number; round?: boolean; style?: CSSProperties; className?: string; alt?: string }) {
  const [look, setLook] = useState<Look | null>(() => cache.get(src) ?? null);
  const [cors, setCors] = useState(true);
  useEffect(() => { setLook(cache.get(src) ?? null); setCors(true); }, [src]);

  const tile: CSSProperties = {
    width: size, height: size, borderRadius: round ? '50%' : 12, overflow: 'hidden', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: look ? look.bg : 'var(--surface-2)', transition: 'background .2s', ...style,
  };
  return (
    <span className={className} style={tile}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt={alt} crossOrigin={cors ? 'anonymous' : undefined}
        style={{ maxWidth: look && !look.pad ? '100%' : '80%', maxHeight: look && !look.pad ? '100%' : '80%', objectFit: 'contain' }}
        onLoad={(e) => { if (cache.has(src)) return; const l = analyse(e.currentTarget); if (l) { cache.set(src, l); setLook(l); } }}
        onError={() => { if (cors) setCors(false); }} // server without CORS: show the logo anyway, just without analysis
      />
    </span>
  );
}
