'use client';
import { useEffect } from 'react';

/**
 * PageDown / PageUp move to the next / previous field of the page the cursor is in (inputs, lists,
 * text boxes, check boxes, and pickers marked `data-field`), in the order they appear on the page.
 * Outside a field the keys scroll the page as usual. Inside a dialog only that dialog's fields count.
 */
const FIELDS = [
  'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=image])',
  'select', 'textarea', '[data-field]',
].join(',');

const isField = (el: Element | null): el is HTMLElement => !!el && el instanceof HTMLElement && el.matches(FIELDS);
const usable = (el: HTMLElement) =>
  !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly && el.tabIndex !== -1
  && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const DIALOG = '[role=dialog], .pmodal';

export function FieldKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'PageDown' && e.key !== 'PageUp') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const here = document.activeElement;
      if (!isField(here)) return;
      // A dialog keeps the keys to itself; on a page, the dialogs (portals) are not part of the form.
      const box = here.closest(DIALOG) ?? document.body;
      const list = Array.from(box.querySelectorAll<HTMLElement>(FIELDS))
        .filter((el) => (el === here || usable(el)) && (box !== document.body || !el.closest(DIALOG)));
      const i = list.indexOf(here);
      if (i < 0) return;
      const to = list[e.key === 'PageDown' ? i + 1 : i - 1];
      e.preventDefault();
      if (!to) return; // first / last field: stay
      to.focus();
      if (to instanceof HTMLInputElement && /^(text|search|tel|email|url|number|)$/.test(to.type)) { try { to.select(); } catch { /* not selectable */ } }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
