'use client';

/**
 * Dual-thumb amount range (ریال), 0 → 100,000,000,000.
 * The bar uses a cubic scale so small amounts (millions) stay selectable next to the
 * 100-billion ceiling; values snap to 2 significant digits. An end left at its limit
 * means «no bound» and is reported as ''.
 */
const STEPS = 1000;
export const RANGE_MAX = 100_000_000_000;

const nice = (v: number) => {
  if (v <= 0) return 0;
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.min(RANGE_MAX, Math.round(v / mag) * mag);
};
const toVal = (p: number) => (p >= STEPS ? RANGE_MAX : nice(RANGE_MAX * (p / STEPS) ** 3));
const toPos = (v: number) => Math.max(0, Math.min(STEPS, Math.round(STEPS * Math.cbrt(v / RANGE_MAX))));

export function fmtRial(v: number): string {
  const f = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
  if (v >= 1e9) return `${f(v / 1e9)} میلیارد`;
  if (v >= 1e6) return `${f(v / 1e6)} میلیون`;
  if (v >= 1e3) return `${f(v / 1e3)} هزار`;
  return f(v);
}

export function RangeSlider({ label, min, max, onChange }: {
  label: string; min: string; max: string; onChange: (min: string, max: string) => void;
}) {
  const lo = min ? toPos(Number(min)) : 0;
  const hi = max ? toPos(Number(max)) : STEPS;
  const loV = min ? Number(min) : 0;
  const hiV = max ? Number(max) : RANGE_MAX;

  const setLo = (p: number) => { const q = Math.min(p, hi); onChange(q <= 0 ? '' : String(toVal(q)), max); };
  const setHi = (p: number) => { const q = Math.max(p, lo); onChange(min, q >= STEPS ? '' : String(toVal(q))); };

  return (
    <div className="rslider">
      <div className="rslider-head">
        <span className="rslider-label">{label}</span>
        <span className="rslider-val">
          از <b>{fmtRial(loV)}</b> تا <b>{fmtRial(hiV)}</b> ریال
        </span>
      </div>
      <div className="rslider-track">
        <div className="rslider-fill" style={{ insetInlineStart: `${(lo / STEPS) * 100}%`, width: `${((hi - lo) / STEPS) * 100}%` }} />
        <input type="range" min={0} max={STEPS} value={lo} onChange={(e) => setLo(+e.target.value)}
          aria-label={`${label} — حداقل`} style={{ zIndex: lo > STEPS - 20 ? 4 : 3 }} />
        <input type="range" min={0} max={STEPS} value={hi} onChange={(e) => setHi(+e.target.value)}
          aria-label={`${label} — حداکثر`} style={{ zIndex: 3 }} />
      </div>
      <div className="rslider-scale"><span>۰</span><span>۱۰۰ میلیارد</span></div>
    </div>
  );
}
