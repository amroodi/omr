/**
 * The whole site's «در حال بارگذاری»: every request to the server counts while it runs, and the global
 * spinner (components/GlobalSpinner) blurs the page and blocks clicks until none is left — as Sinad does.
 * Background polls, as-you-type lookups and uploads (they show their own progress) don't count.
 */
const QUIET: RegExp[] = [
  /\/notifications(\/|\?|$)/, // the bell's 30-second poll
  /\/policyholder-companies\/search/, // typeahead
  /\/inquiry\/messages/, // «گفتگو» refresh
  /\/messages\/(unread|poll)/,
];
const MAX_MS = 45_000; // a request that never answers can't lock the page for ever

let pending = 0;
const subs = new Set<(busy: boolean) => void>();
const emit = () => subs.forEach((f) => f(pending > 0));

export function onBusy(f: (busy: boolean) => void): () => void {
  subs.add(f);
  f(pending > 0);
  return () => { subs.delete(f); };
}

/** A page change in progress (a link clicked): counts until the new address shows (or 10 s). */
let navEnd: (() => void) | null = null;
export function beginNav() {
  navEnd?.();
  let resolve!: () => void;
  const p = new Promise<void>((r) => { resolve = r; });
  navEnd = () => { resolve(); navEnd = null; };
  void track('#nav', Promise.race([p, new Promise<void>((r) => setTimeout(r, 10_000))]), 'NAV');
}
export function endNav() { navEnd?.(); }

/** Count `p` as a running load (unless it is a GET of a quiet path: polls and lookups only read). */
export function track<T>(path: string, p: Promise<T>, method = 'GET'): Promise<T> {
  if (typeof window === 'undefined' || (method === 'GET' && QUIET.some((r) => r.test(path)))) return p;
  pending++;
  emit();
  let done = false;
  const end = () => { if (done) return; done = true; pending = Math.max(0, pending - 1); emit(); };
  const t = setTimeout(end, MAX_MS);
  return p.finally(() => { clearTimeout(t); end(); });
}
