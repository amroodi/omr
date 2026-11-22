'use client';
import { RefObject, useLayoutEffect, useState } from 'react';

/**
 * A required filing field («… *») that is still empty: none of its inputs, selects or pickers holds a value.
 * The field gets a faded red background until it is filled, so the operator sees what is left at a glance.
 */
export function useMissing(ref: RefObject<HTMLElement | null>, required: boolean): boolean {
  const [missing, setMissing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !required) { setMissing(false); return; }
    const check = () => {
      const controls = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')];
      setMissing(controls.length > 0 && controls.every((c) => !c.value.trim()));
    };
    check();
    el.addEventListener('input', check);
    el.addEventListener('change', check);
    return () => { el.removeEventListener('input', check); el.removeEventListener('change', check); };
  });
  return missing;
}
