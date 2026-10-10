'use client';
import { useEffect, useRef } from 'react';

/**
 * Interactive dotted-grid background. A square lattice of faint dots that light up brand-orange
 * where the cursor passes and ease back to their faint base color as it moves away. Pure canvas,
 * fixed & non-interactive, DPR-aware, theme-aware (reads --text / --brand), respects
 * prefers-reduced-motion (static grid then).
 */
export function DotGrid({ gap = 26, radius = 160, dotSize = 1.4, baseAlpha = 0.18, hotAlpha = 0.95 }: {
  gap?: number; radius?: number; dotSize?: number; baseAlpha?: number; hotAlpha?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0;
    let hot = new Float32Array(0); // per-dot "heat" 0..1 (1 = under cursor)
    const mouse = { x: -9999, y: -9999 };
    let raf = 0;

    const cssVar = (name: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const toRgb = (c: string): [number, number, number] => {
      c = c.trim();
      if (c[0] === '#') {
        let hex = c.slice(1);
        if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
        const n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      const m = c.match(/(\d+(?:\.\d+)?)/g);
      return m ? [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0] : [128, 128, 128];
    };
    let base = toRgb(cssVar('--text', '#0f1729'));
    let brand = toRgb(cssVar('--brand', '#ff9500'));
    const readColors = () => { base = toRgb(cssVar('--text', '#0f1729')); brand = toRgb(cssVar('--brand', '#ff9500')); };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / gap) + 1;
      rows = Math.ceil(h / gap) + 1;
      hot = new Float32Array(cols * rows);
      if (reduced) drawStatic();
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${baseAlpha})`;
      for (let gy = 0; gy < rows; gy++)
        for (let gx = 0; gx < cols; gx++) {
          ctx.beginPath();
          ctx.arc(gx * gap, gy * gap, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const r2 = radius * radius;
      for (let gy = 0; gy < rows; gy++) {
        const y = gy * gap;
        for (let gx = 0; gx < cols; gx++) {
          const x = gx * gap;
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d2 = dx * dx + dy * dy;
          // target heat: 1 at the cursor, easing to 0 at the hover radius
          const target = d2 < r2 ? 1 - Math.sqrt(d2) / radius : 0;
          const i = gy * cols + gx;
          hot[i] += (target - hot[i]) * 0.2; // ease
          const t = hot[i];
          // blend base → brand, and base faintness → full as the dot heats up
          const r = base[0] + (brand[0] - base[0]) * t;
          const g = base[1] + (brand[1] - base[1]) * t;
          const b = base[2] + (brand[2] - base[2]) * t;
          const a = baseAlpha + (hotAlpha - baseAlpha) * t;
          ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, dotSize + t * 0.9, 0, Math.PI * 2); // hot dots swell slightly
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };

    resize();
    window.addEventListener('resize', resize);
    if (!reduced) {
      window.addEventListener('mousemove', onMove, { passive: true });
      window.addEventListener('mouseout', onLeave);
      raf = requestAnimationFrame(draw);
    }
    const obs = new MutationObserver(() => { readColors(); if (reduced) drawStatic(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      obs.disconnect();
    };
  }, [gap, radius, dotSize, baseAlpha, hotAlpha]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />;
}
