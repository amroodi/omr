'use client';
import { CSSProperties, useEffect, useId, useRef, useState } from 'react';

/**
 * Day/night switch with a small landscape in its track: a sunlit desert by day, blue hills under
 * twinkling stars by night. Controlled: pass `checked` (true = night) and `onChange`; it does not
 * touch the theme or storage itself.
 *
 *   const [night, setNight] = useState(false);
 *   <DayNightToggle checked={night} onChange={setNight} label="حالت شب" />
 *   <DayNightToggle checked={night} onChange={setNight} label="حالت شب" size={0.42} /> // compact
 *
 * Press: the knob stretches toward the centre (outer edge anchored). Release: it slides to the other
 * end and springs back to a circle. The two scenes are separate layers that crossfade — the dunes
 * never morph into hills.
 */

/** Base geometry (px at size = 1) and timings — tweak here. */
export const DAY_NIGHT_TOGGLE = {
  trackW: 184, trackH: 88, knob: 70, inset: 9,
  pressW: 98, pressH: 64,
  pressMs: 220, releaseMs: 680, fadeMs: 400,
  colors: {
    dayKnob: '#FF9500',
    nightKnobFrom: '#F6F8FC', nightKnobTo: '#D3DFEF', moon: '#5B7BAA',
  },
};

export interface DayNightToggleProps {
  /** true = night (knob on the right). */
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name, e.g. «حالت شب». */
  label: string;
  /** Scale factor (1 = 184 × 88 px). */
  size?: number;
  disabled?: boolean;
  className?: string;
  /** Extra tooltip; defaults to describing what a click will do. */
  title?: string;
}

export function DayNightToggle({ checked, onChange, label, size = 1, disabled, className, title }: DayNightToggleProps) {
  const g = DAY_NIGHT_TOGGLE;
  const [pressed, setPressed] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const uid = useId().replace(/:/g, '');

  // Pause the decorative loops (sunlight band, star twinkle) while the switch is off screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPaused(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const s = size;
  const kw = (pressed ? g.pressW : g.knob) * s;
  const kh = (pressed ? g.pressH : g.knob) * s;
  // Outer edge anchored: by day the left edge stays put, by night the right edge.
  const dx = checked ? g.trackW * s - 2 * g.inset * s - kw : 0;

  const style = {
    '--dn-s': s, '--dn-w': `${g.trackW * s}px`, '--dn-h': `${g.trackH * s}px`, '--dn-i': `${g.inset * s}px`,
    '--dn-kw': `${kw}px`, '--dn-kh': `${kh}px`, '--dn-dx': `${dx}px`, '--dn-icon': `${g.knob * s * 0.5}px`,
    '--dn-press': `${g.pressMs}ms`, '--dn-release': `${g.releaseMs}ms`, '--dn-fade': `${g.fadeMs}ms`,
    '--dn-day-knob': g.colors.dayKnob, '--dn-night-a': g.colors.nightKnobFrom, '--dn-night-b': g.colors.nightKnobTo,
  } as CSSProperties;

  const release = () => setPressed(false);
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title ?? (checked ? 'رفتن به حالت روز' : 'رفتن به حالت شب')}
      disabled={disabled}
      className={`dn${checked ? ' is-night' : ''}${pressed ? ' is-pressed' : ''}${paused ? ' is-paused' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onPointerDown={(e) => { if (e.button === 0 && !disabled) setPressed(true); }}
      onPointerLeave={release}
      onPointerCancel={release}
      onKeyDown={(e) => { if (e.key === ' ' && !e.repeat) setPressed(true); }}
      onKeyUp={(e) => { if (e.key === ' ') release(); }}
      onBlur={release}
      // The click (mouse, touch, Enter, Space, assistive tech) both flips the state and releases the
      // press, in the same render — so the knob slides and springs back in one motion.
      onClick={() => { setPressed(false); onChange(!checked); }}
    >
      <span className="dn-track" aria-hidden>
        {/* Day: sky, a slow band of sunlight, two dunes */}
        <svg className="dn-scene dn-day" viewBox="0 0 184 88" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`${uid}-dsky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3E8EDF" />
              <stop offset="0.5" stopColor="#86C1F0" />
              <stop offset="0.78" stopColor="#D9ECF6" />
              <stop offset="0.92" stopColor="#F6E7C5" />
            </linearGradient>
            <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#FFF8E6" stopOpacity="0.32" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-dune1`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F6DCA4" />
              <stop offset="1" stopColor="#EAC07A" />
            </linearGradient>
            <linearGradient id={`${uid}-dune2`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FBE3AE" />
              <stop offset="0.45" stopColor="#EDBD6E" />
              <stop offset="1" stopColor="#D69444" />
            </linearGradient>
          </defs>
          <rect width="184" height="88" fill={`url(#${uid}-dsky)`} />
          <g className="dn-band"><rect x="-90" y="-30" width="54" height="150" fill={`url(#${uid}-band)`} transform="rotate(16)" /></g>
          <path d="M0 58 C 26 49, 52 47, 82 53 C 108 58, 136 62, 184 50 L 184 88 L 0 88 Z" fill={`url(#${uid}-dune1)`} />
          <path d="M0 73 C 32 62, 66 60, 100 67 C 128 73, 156 70, 184 63 L 184 88 L 0 88 Z" fill={`url(#${uid}-dune2)`} />
          <path d="M0 73 C 32 62, 66 60, 100 67 C 128 73, 156 70, 184 63" fill="none" stroke="#FFF6DE" strokeOpacity="0.75" strokeWidth="1" />
        </svg>

        {/* Night: deep sky, twinkling stars, two subdued hills */}
        <svg className="dn-scene dn-night" viewBox="0 0 184 88" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`${uid}-nsky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#061230" />
              <stop offset="0.6" stopColor="#0E2452" />
              <stop offset="1" stopColor="#1B3A72" />
            </linearGradient>
          </defs>
          <rect width="184" height="88" fill={`url(#${uid}-nsky)`} />
          {STARS.map(([x, y, r, d, t], i) => (
            <circle key={i} className="dn-star" cx={x} cy={y} r={r} fill="#EAF1FF" style={{ animationDelay: `${d}s`, animationDuration: `${t}s` }} />
          ))}
          <path d="M0 61 C 28 51, 58 53, 90 59 C 120 64, 150 50, 184 57 L 184 88 L 0 88 Z" fill="#1E3B6E" />
          <path d="M0 72 C 38 64, 78 65, 118 71 C 146 75, 168 70, 184 67 L 184 88 L 0 88 Z" fill="#132A52" />
        </svg>

        <span className="dn-knob">
          <span className="dn-face dn-face-day" />
          <span className="dn-face dn-face-night" />
          <svg className="dn-icon dn-sun" viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
            <circle cx="16" cy="16" r="5.6" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <line key={a} x1="16" y1="6.2" x2="16" y2="8.6" transform={`rotate(${a} 16 16)`} />
            ))}
          </svg>
          <svg className="dn-icon dn-moon" viewBox="0 0 32 32">
            <path d="M20.6 21.9A8.6 8.6 0 0 1 12.3 9.1a.6.6 0 0 0-.8-.7A9.6 9.6 0 1 0 23.4 21a.6.6 0 0 0-.7-.8 8.5 8.5 0 0 1-2.1 1.7z" fill={g.colors.moon} />
          </svg>
        </span>
      </span>
    </button>
  );
}

/** [cx, cy, r, delay s, duration s] — different rhythms so the stars never blink together. */
const STARS: [number, number, number, number, number][] = [
  [22, 14, 1.1, 0, 3.2], [44, 26, 0.8, 1.1, 4.1], [63, 11, 1.2, 0.5, 3.7], [86, 22, 0.8, 2.2, 4.6],
  [104, 9, 1, 1.6, 3.4], [126, 19, 1.3, 0.3, 4.9], [148, 12, 0.9, 2.7, 3.9], [166, 27, 1.1, 1.2, 4.3], [35, 36, 0.7, 3.1, 5.2],
];
