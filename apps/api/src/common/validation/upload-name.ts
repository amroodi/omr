/**
 * Name of an uploaded file as the user saw it.
 *
 * Browsers send the multipart file name as UTF-8, but the upload parser (multer → busboy) reads it as
 * Latin-1 — so «گزارش.pdf» arrives as «Ú¯Ø²Ø§Ø±Ø´.pdf» (every Persian letter split into two Latin
 * ones). Re-reading those Latin-1 characters as the bytes they were and decoding UTF-8 gives back the
 * real name. A name that already holds characters beyond Latin-1 (it is real text) or that isn't valid
 * UTF-8 once re-read (a genuine Latin-1 name like «café.pdf») is left as it is — so this is safe to
 * apply twice, which the repair script relies on.
 */
export function uploadName(name: string | null | undefined): string {
  const s = String(name ?? '');
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.includes('�') ? s : fixed.normalize('NFC');
}
