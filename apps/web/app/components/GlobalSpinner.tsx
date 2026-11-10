'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { beginNav, endNav, onBusy } from '../../lib/busy';

const SHOW_AFTER = 200; // a quick answer doesn't flash the screen
const MIN_SHOWN = 350; // once shown, long enough to read as one motion

/**
 * The one loading spinner of every panel and login (Sinad's): while anything loads, the page is blurred,
 * nothing can be clicked, and two glowing arcs turn in the middle — the outer green one way, the inner
 * orange the other — over «در حال بارگذاری لطفا منتظر بمانید».
 */
export function GlobalSpinner() {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  const pathname = usePathname();
  // Moving to another page counts as loading too, from the click until the new page is there.
  useEffect(() => { endNav(); }, [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      // only a move to another page (a tab on the same page loads through its own requests)
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      beginNav();
    };
    document.addEventListener('click', onClick, true); // before Next's <Link> takes the click
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  useEffect(() => {
    let showT: ReturnType<typeof setTimeout> | undefined;
    let hideT: ReturnType<typeof setTimeout> | undefined;
    return onBusy((busy) => {
      clearTimeout(hideT);
      if (busy) {
        if (!showT) showT = setTimeout(() => { since.current = Date.now(); setShown(true); }, SHOW_AFTER);
        return;
      }
      clearTimeout(showT); showT = undefined;
      hideT = setTimeout(() => setShown(false), Math.max(0, MIN_SHOWN - (Date.now() - since.current)));
    });
  }, []);
  useEffect(() => {
    if (!shown) return;
    // Keys can't reach the page either (no typing or Enter behind the spinner).
    const stop = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('keydown', stop, true);
    return () => window.removeEventListener('keydown', stop, true);
  }, [shown]);
  if (!shown) return null;
  return (
    <div className="gsp" role="status" aria-live="polite" aria-label="در حال بارگذاری">
      <div className="gsp-rings" aria-hidden>
        <span className="gsp-ring is-outer"><b /><i /></span>
        <span className="gsp-ring is-inner"><b /><i /></span>
      </div>
      <div className="gsp-text">در حال بارگذاری لطفا منتظر بمانید</div>
    </div>
  );
}
