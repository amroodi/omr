'use client';
import { useEffect, useRef } from 'react';

/**
 * Interactive dotted-grid background. A square lattice of faint dots that fade out where the
 * cursor touches them and ease back in as it moves away. Pure canvas, fixed & non-interactive,
 * DPR-aware, theme-aware (reads --text), and respects prefers-reduced-motion (static grid then).
 */
export function DotGrid({ gap = 26, radius = 100, dotSize = 1.3, baseAlpha = 0.18 }: {
  gap?: number; radius?: number; dotSize?: number; baseAlpha?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, cols = 0, rows = 0;
    let op = new Float32Array(0); // per-dot current opacity (0..1)
    const mouse = { x: -9999, y: -9999 };
    let raf = 0;

    const readColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
    let color = readColor();

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
      op = new Float32Array(cols * rows).fill(1);
      if (reduced) drawStatic();
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.globalAlpha = baseAlpha;
      for (let gy = 0; gy < rows; gy++)
        for (let gx = 0; gx < cols; gx++) {
          ctx.beginPath();
          ctx.arc(gx * gap, gy * gap, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const r2 = radius * radius;
      for (let gy = 0; gy < rows; gy++) {
        const y = gy * gap;
        for (let gx = 0; gx < cols; gx++) {
          const x = gx * gap;
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d2 = dx * dx + dy * dy;
          // target opacity: 0 right at the cursor, ramping back to 1 at the hover radius
          const target = d2 < r2 ? Math.sqrt(d2) / radius : 1;
          const i = gy * cols + gx;
          op[i] += (target - op[i]) * 0.2; // ease
          const o = op[i];
          if (o > 0.02) {
            ctx.globalAlpha = o * baseAlpha;
            ctx.beginPath();
            ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
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
    const obs = new MutationObserver(() => { color = readColor(); if (reduced) drawStatic(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      obs.disconnect();
    };
  }, [gap, radius, dotSize, baseAlpha]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }} />;
}
