/**
 * Proportional desktop scaling: the site is designed for a 1440×900 screen; on any desktop/laptop
 * screen the whole page is scaled (CSS zoom on <html>) so it looks the same on a 1366×768 laptop and a
 * 2560×1440 monitor — same proportions, no extra scroll on small screens, no shrunken panels on big ones.
 *
 * - Based on the SCREEN size (unaffected by browser zoom), so Ctrl+/Ctrl− still works on top of it and
 *   resizing the window does not make the page jump.
 * - Capped by the window width so a half-screen window on a big monitor never overflows.
 * - Phones/tablets (window < 1024 CSS px) keep zoom 1 and use their responsive layouts.
 * - Exposes `--app-zoom`; full-window heights use `--zvh` (1vh corrected for the zoom).
 * - The signed-in بیمه‌گزار panel (/customer, not its login) isn't scaled: its sizes are exact pixels
 *   measured from the Sinad portal.
 */
export const SCALE_BOOT_SCRIPT = `(function(){
  var BW=1440,BH=900,MINW=1100;
  function apply(){
    var d=document.documentElement,w=innerWidth,s=1;
    var p=location.pathname,exact=p==='/customer'||(p.indexOf('/customer/')===0&&p.indexOf('/customer/login')!==0);
    if(w>=1024&&!exact){
      var sw=screen.width||w,sh=screen.height||innerHeight;
      s=Math.min(sw/BW,sh/BH,w/MINW);
      s=Math.max(0.8,Math.min(1.9,s));
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
