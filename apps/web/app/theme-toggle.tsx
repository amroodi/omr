'use client';
import { useEffect, useState } from 'react';
import { DayNightToggle } from './components/DayNightToggle';

/**
 * The app's theme switch: DayNightToggle wired to the `.dark` class on <html> and localStorage.theme
 * (the boot script in layout.tsx applies the stored theme before hydration).
 * Until the real theme is read it stays hidden with transitions off, so the knob never slides on load.
 */
export function ThemeToggle({ size = 0.36 }: { size?: number }) {
  const [dark, setDark] = useState(true);
  const [synced, setSynced] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setSynced(true);
  }, []);
  useEffect(() => {
    if (!synced) return;
    // Force a style flush with the real state applied (transitions still off), then reveal it.
    void document.body.getBoundingClientRect();
    setReady(true);
  }, [synced]);
  const change = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
  };
  return (
    <DayNightToggle
      checked={dark}
      onChange={change}
      label="حالت تاریک"
      size={size}
      className={ready ? undefined : 'dn-boot'}
    />
  );
}
