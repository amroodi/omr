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
