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
        {/* Day: a pearl sky in the site's light greys, a soft warm glow, a slow band of light, and
            three frosted-glass layers, each with a fine lit edge */}
        <svg className="dn-scene dn-day" viewBox="0 0 184 88" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`${uid}-dsky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#DCE3F0" />
              <stop offset="0.5" stopColor="#EEF1F8" />
              <stop offset="0.85" stopColor="#FBF4EA" />
            </linearGradient>
            <radialGradient id={`${uid}-glow`} cx="0.74" cy="0.3" r="0.55">
              <stop offset="0" stopColor="#FFA526" stopOpacity="0.42" />
              <stop offset="0.45" stopColor="#FFC877" stopOpacity="0.18" />
              <stop offset="1" stopColor="#FFF2E0" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-band`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-g1`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#C9D3E6" stopOpacity="0.75" />
              <stop offset="1" stopColor="#B7C3DA" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id={`${uid}-g2`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#E9EEF7" stopOpacity="0.85" />
              <stop offset="1" stopColor="#D2DBEA" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id={`${uid}-g3`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
              <stop offset="1" stopColor="#F2F4FA" stopOpacity="0.9" />
            </linearGradient>
            <filter id={`${uid}-soft`} x="-5%" y="-20%" width="110%" height="140%">
              <feGaussianBlur stdDeviation="0.9" />
            </filter>
          </defs>
          <rect width="184" height="88" fill={`url(#${uid}-dsky)`} />
          <rect width="184" height="88" fill={`url(#${uid}-glow)`} />
          <circle cx="146" cy="24" r="8" fill="#FFB547" fillOpacity="0.55" filter={`url(#${uid}-soft)`} />
          <g className="dn-band"><rect x="-90" y="-30" width="54" height="150" fill={`url(#${uid}-band)`} transform="rotate(16)" /></g>
          <path d="M0 52 C 30 44, 60 45, 92 51 C 124 57, 152 46, 184 49 L 184 88 L 0 88 Z" fill={`url(#${uid}-g1)`} filter={`url(#${uid}-soft)`} />
          <path d="M0 52 C 30 44, 60 45, 92 51 C 124 57, 152 46, 184 49" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.7" />
          <path d="M0 64 C 34 56, 70 57, 104 62 C 134 66, 160 59, 184 58 L 184 88 L 0 88 Z" fill={`url(#${uid}-g2)`} />
          <path d="M0 64 C 34 56, 70 57, 104 62 C 134 66, 160 59, 184 58" fill="none" stroke="#fff" strokeOpacity="0.95" strokeWidth="0.8" />
          <path d="M0 75 C 38 68, 80 69, 120 73 C 148 76, 168 72, 184 70 L 184 88 L 0 88 Z" fill={`url(#${uid}-g3)`} />
          <path d="M0 75 C 38 68, 80 69, 120 73 C 148 76, 168 72, 184 70" fill="none" stroke="#fff" strokeWidth="0.9" />
          <path d="M0 75.8 C 38 68.8, 80 69.8, 120 73.8 C 148 76.8, 168 72.8, 184 70.8" fill="none" stroke="#AEBBD3" strokeOpacity="0.45" strokeWidth="0.6" />
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
