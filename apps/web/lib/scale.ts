/**
 * Proportional desktop scaling: the site is designed for a screen 1536 wide; on any desktop/laptop
 * screen the whole page is scaled (CSS zoom on <html>) so an item takes the same share of the screen on
 * a 22-inch and a 32-inch monitor — no extra scroll on small screens, no shrunken panels on big ones.
 *
 * - Based on the SCREEN size (unaffected by browser zoom), so Ctrl+/Ctrl− still works on top of it and
 *   resizing the window does not make the page jump.
 * - Capped by the window width so a half-screen window on a big monitor never overflows.
 * - Phones/tablets (window < 1024 CSS px) keep zoom 1 and use their responsive layouts.
 * - Exposes `--app-zoom`; full-window heights use `--zvh` (1vh corrected for the zoom).
 */
export const SCALE_BOOT_SCRIPT = `(function(){
  var BW=1536,MINW=1100;
  function apply(){
    var d=document.documentElement,w=innerWidth,s=1;
    if(w>=1024){
      s=Math.min((screen.width||w)/BW,w/MINW);
      s=Math.max(0.7,Math.min(2.6,s));
      s=Math.round(s*100)/100;
    }
    d.style.zoom=s===1?'':String(s);
    d.style.setProperty('--app-zoom',String(s));
  }
  apply();
  addEventListener('resize',apply);
})();`;

/** Current page zoom set by SCALE_BOOT_SCRIPT (1 when unscaled). */
export function appZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom'));
  return z > 0 ? z : 1;
}
