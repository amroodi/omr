/**
 * Save part of the page as a PDF file. The element is captured with html-to-image (the browser itself
 * draws the text, so Persian letters join correctly) and laid onto A4 pages with jsPDF; a long capture
 * is split across pages. Elements with the class `no-pdf` (buttons etc.) are left out.
 */
export async function downloadPdf(el: HTMLElement, fileName: string): Promise<void> {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const png = await toPng(el, {
    pixelRatio: 2,
    backgroundColor: bg,
    cacheBust: true,
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains('no-pdf')),
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = png;
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 8;
  const pageW = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageH = pdf.internal.pageSize.getHeight() - margin * 2;
  const pxPerMm = img.width / pageW;
  const slicePx = Math.floor(pageH * pxPerMm); // image height that fits on one page

  // Cut the capture into page-high slices on a canvas, one PDF page each.
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0, page = 0; y < img.height; y += slicePx, page++) {
    const h = Math.min(slicePx, img.height - y);
    canvas.height = h;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, h);
    ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pageW, h / pxPerMm);
  }
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, '-'); // policy numbers contain slashes
  pdf.save(safe.endsWith('.pdf') ? safe : `${safe}.pdf`);
}

/** Today in the Persian calendar, «۱۴۰۵/۰۸/۲۳». */
export function jalaliToday(): string {
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const NAVY = '#012454';
const ORANGE = '#f7941d';
const A4_PX = 794;
const dot = (path: string) => `<span style="width:26px;height:26px;border-radius:50%;background:${NAVY};display:inline-flex;align-items:center;justify-content:center"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></span>`;
const ICON_PHONE = dot('M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z');
const ICON_GLOBE = dot('M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z'); // A4 width at 96 dpi: the letterhead parts are drawn at this width, then laid edge to edge

/** Draw a small piece of HTML off screen and capture it (the browser joins the Persian letters). */
async function capture(html: string, width: number): Promise<HTMLImageElement> {
  const { toPng } = await import('html-to-image');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;direction:rtl;font-family:inherit;color:#111;background:#fff;`;
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    // The part inside the off-screen holder (the holder's own far-off position would go into the image).
    const png = await toPng(host.firstElementChild as HTMLElement, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
    return await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = png; });
  } finally { host.remove(); }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Save part of the page as a PDF on Damuon's letterhead (the designer's template): every page has the navy and
 * orange band on top and the orange footer with the phone and website; the first page also has the logo, the
 * title and its boxes («تاریخ گزارش», …). The content runs on, page after page, between them.
 */
export async function downloadBrandedPdf(el: HTMLElement, fileName: string, opts: { title: string; meta?: { label: string; value: string }[] }): Promise<void> {
  // Paper is white: capture in the light theme even when the app is dark.
  // A page as wide as a desktop window would come out tiny on A4: it is laid out at a paper-like width meanwhile.
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const width = el.style.width;
  root.classList.remove('dark');
  if (el.offsetWidth > 900) el.style.width = '900px';
  try { await branded(el, fileName, opts); } finally { if (dark) root.classList.add('dark'); el.style.width = width; }
}

async function branded(el: HTMLElement, fileName: string, opts: { title: string; meta?: { label: string; value: string }[] }): Promise<void> {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const meta = [{ label: 'تاریخ گزارش', value: jalaliToday() }, ...(opts.meta ?? [])];
  const header = await capture(`
    <div style="display:flex;align-items:center;gap:22px;padding:6px 30px 0">
      <img src="/brand/damuon-logo.webp" style="height:86px;width:auto;object-fit:contain" />
      <div style="flex:1;text-align:center">
        <div style="font-size:30px;font-weight:900;color:${NAVY};padding-bottom:8px;border-bottom:1.5px solid ${ORANGE}">${esc(opts.title)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-width:150px">
        ${meta.map((m) => `<div style="background:#ececec;padding:5px 10px;font-size:12px;white-space:nowrap"><span style="color:#8a8a8a">${esc(m.label)} :</span> <b style="font-weight:700;color:#222">${esc(m.value)}</b></div>`).join('')}
      </div>
    </div>`, A4_PX);
  const footer = await capture(`
    <div style="padding:0 40px;background:#fff">
      <div style="background:${ORANGE};border-top:4px solid ${NAVY};border-radius:34px 34px 0 0;height:44px;display:flex;align-items:center;justify-content:center;gap:34px;color:#fff;font-size:17px;font-weight:600">
        <span style="display:inline-flex;align-items:center;gap:8px;direction:ltr">${ICON_GLOBE} www.damuon.com</span>
        <span style="display:inline-flex;align-items:center;gap:8px;direction:ltr">${ICON_PHONE} ۰۲۱-۵۷۳۸۹۰۰۰</span>
      </div>
    </div>`, A4_PX);
  // Where a page may end: under a table row, a list item or a block (never through a line of text).
  const box = el.getBoundingClientRect();
  const bottoms = [...el.querySelectorAll('tr, li, p, h1, h2, h3, h4, .pcard, .ev-item, :scope > *, :scope > * > *')]
    .map((n) => n.getBoundingClientRect().bottom - box.top).filter((v) => v > 0);
  const bodyPng = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true, filter: (n) => !(n instanceof HTMLElement && n.classList.contains('no-pdf')) });
  const body = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = bodyPng; });
  const cuts = bottoms.map((b) => Math.round((b / box.height) * body.height)).sort((x, y) => x - y); // in the capture's pixels

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(); const H = pdf.internal.pageSize.getHeight();
  const mmOf = (img: HTMLImageElement) => (img.height / img.width) * W; // a letterhead part's height at full page width
  const headH = mmOf(header); const footH = mmOf(footer);
  const side = 14; const bandH = 6.5; const gap = 6;
  const bodyW = W - side * 2;
  const pxPerMm = body.width / bodyW;
  const canvas = document.createElement('canvas');
  canvas.width = body.width;
  const ctx = canvas.getContext('2d')!;
  let y = 0; let page = 0;
  while (y < body.height || page === 0) {
    if (page > 0) pdf.addPage();
    pdf.setFillColor(NAVY); pdf.rect(0, 0, W, bandH - 1.6, 'F');
    pdf.setFillColor(ORANGE); pdf.rect(0, bandH - 1.6, W, 1.6, 'F');
    let top = bandH + gap;
    if (page === 0) { pdf.addImage(header.src, 'PNG', 0, top, W, headH); top += headH + gap; }
    pdf.addImage(footer.src, 'PNG', 0, H - footH, W, footH);
    const room = H - footH - gap - top;
    const fit = Math.floor(room * pxPerMm);
    let h = Math.min(fit, body.height - y);
    if (y + fit < body.height) { const cut = [...cuts].reverse().find((c) => c > y + fit * 0.5 && c <= y + fit); if (cut) h = cut - y; }
    if (h > 0) {
      canvas.height = h;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, h);
      ctx.drawImage(body, 0, y, body.width, h, 0, 0, body.width, h);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', side, top, bodyW, h / pxPerMm);
    }
    y += Math.max(h, 1); page++;
  }
  const safe = fileName.replace(/[\/:*?"<>|]+/g, '-');
  pdf.save(safe.endsWith('.pdf') ? safe : `${safe}.pdf`);
}
