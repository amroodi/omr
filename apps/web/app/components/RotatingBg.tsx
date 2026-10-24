'use client';
import { useEffect, useState } from 'react';

/** Images for one login page: names under /public/login-bg, each exported as `<name>-1280.webp` and `<name>-2560.webp`. */
export interface LoginBgSet { light: string[]; dark: string[] }

const ROTATE_MS = 8000;

/** Phones and small screens get the 1280px export; everything else the 2560px one. */
function sizeFor(): number {
  const px = window.innerWidth * (window.devicePixelRatio || 1);
  return px <= 1400 ? 1280 : 2560;
}

/**
 * Full-screen login background that crossfades through the images of the current theme (light/dark).
 * Only the visible image is loaded at first; the next one is fetched before the switch, so the fade
 * never shows a half-loaded picture. Rotation pauses while the tab is hidden.
 */
export function RotatingBg({ set }: { set: LoginBgSet }) {
  const [dark, setDark] = useState(false);
  const [size, setSize] = useState(0); // 0 until mounted (no image during the server render)
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState<Set<string>>(new Set());

  // Follow the theme toggle (class "dark" on <html>) live.
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains('dark'));
    read(); setSize(sizeFor());
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  const names = dark ? set.dark : set.light;
  const urls = size ? names.map((n) => `/login-bg/${n}-${size}.webp`) : [];
  const key = urls.join('|');

  const load = (url: string) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = img.onerror = () => { setReady((r) => (r.has(url) ? r : new Set(r).add(url))); done(); };
    img.src = url;
  });

  // New theme or size: start from its first image.
  useEffect(() => {
    if (!urls.length) return;
    setActive(0);
    load(urls[0]).then(() => { if (urls[1]) load(urls[1]); }); // warm up the next one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (urls.length < 2) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      setActive((i) => {
        const next = (i + 1) % urls.length;
        load(urls[(next + 1) % urls.length]); // fetch the one after while this one shows
        return ready.has(urls[next]) ? next : i; // not loaded yet → keep the current one a bit longer
      });
    }, ROTATE_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  return (
    <div className="auth-bg" aria-hidden>
      {urls.map((u, i) => (
        <div key={u} className={`auth-bg-layer${i === active && ready.has(u) ? ' is-on' : ''}`}
          style={ready.has(u) ? { backgroundImage: `url(${u})` } : undefined} />
      ))}
    </div>
  );
}
