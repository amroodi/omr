'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      onClick={toggle}
      className="rounded-lg border px-3 py-1 text-sm"
      style={{ borderColor: 'var(--border)' }}
      aria-label="تغییر حالت روشن/تاریک"
    >
      {dark ? '☀️ روشن' : '🌙 تاریک'}
    </button>
  );
}
