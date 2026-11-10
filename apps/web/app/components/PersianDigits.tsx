'use client';
import { useEffect } from 'react';

const FA = '۰۱۲۳۴۵۶۷۸۹';
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP']);

/** Text that should keep its Latin digits: code blocks, editable text, and anything marked `data-keep-digits`. */
function skipped(n: Node): boolean {
  for (let el = n.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.isContentEditable || el.hasAttribute('data-keep-digits')) return true;
  }
  return false;
}

function fix(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const v = node.nodeValue;
    if (v && /[0-9]/.test(v) && !skipped(node)) node.nodeValue = v.replace(/[0-9]/g, (d) => FA[+d]);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has((node as Element).tagName)) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) fix(t);
}

/**
 * Every number shown on screen is written in Persian digits — case numbers, کد ملی, dates, amounts —
 * whatever the component printed. Only display text changes: what is typed in a field and the values sent
 * to the server stay as they are.
 */
export function PersianDigits() {
  useEffect(() => {
    fix(document.body);
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') fix(m.target);
        else m.addedNodes.forEach(fix);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, []);
  return null;
}
