'use client';

/**
 * نوع بیمه‌نامه. Panel 1 works in one kind at a time: it is chosen on the login (and switched in the top
 * bar), and the dashboard, بیمه‌نامه list, filing form and case lists all follow it. Panel 2 sees every kind.
 */
export type Line = 'LIFE' | 'ACCIDENT' | 'LIABILITY' | 'CREDIT_LIFE' | 'SAVINGS_LIFE';
export const LINES: Line[] = ['LIFE', 'ACCIDENT', 'LIABILITY', 'CREDIT_LIFE', 'SAVINGS_LIFE'];
export const LINE_FA: Record<Line, string> = { LIFE: 'عمر', ACCIDENT: 'حوادث', LIABILITY: 'مسئولیت', CREDIT_LIFE: 'عمر مانده بدهکار', SAVINGS_LIFE: 'عمر پس‌انداز' };

const KEY = 'omr_line';

export function getLine(): Line | null {
  try { const v = localStorage.getItem(KEY); return (LINES as string[]).includes(v ?? '') ? (v as Line) : null; } catch { return null; }
}

export function setLine(line: Line): void {
  try { localStorage.setItem(KEY, line); } catch { /* ignore */ }
}

/** `?line=…` (or `&line=…`) for panel-1 requests; empty when no kind was chosen. */
export function lineQuery(prefix: '?' | '&' = '?'): string {
  const l = getLine();
  return l ? `${prefix}line=${l}` : '';
}
