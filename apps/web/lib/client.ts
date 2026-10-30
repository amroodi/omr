'use client';
import { panelLogin } from './panel';

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api/v1';

export type Realm = 'org' | 'super' | 'customer';

const TOKEN_KEYS: Record<Realm, string> = {
  org: 'omr_org_token',
  super: 'omr_super_token',
  customer: 'omr_customer_token',
};

export function getTenantSlug(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('omr_tenant');
    if (saved) return saved;
  }
  return process.env.NEXT_PUBLIC_TENANT_SLUG || 'damuon';
}

export function setTenantSlug(slug: string): void {
  try {
    localStorage.setItem('omr_tenant', slug);
  } catch {
    /* ignore */
  }
}

export function getToken(realm: Realm): string | null {
  try {
    return localStorage.getItem(TOKEN_KEYS[realm]);
  } catch {
    return null;
  }
}

export function setToken(realm: Realm, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEYS[realm], token);
  } catch {
    /* ignore */
  }
}

export function clearToken(realm: Realm): void {
  try {
    localStorage.removeItem(TOKEN_KEYS[realm]);
  } catch {
    /* ignore */
  }
}

/** Decode the permissions embedded in the realm's JWT (set at login). UI-gating only — the API
 * independently enforces every permission, so a tampered token still can't perform the action. */
export function getPermissions(realm: Realm): string[] {
  const t = getToken(realm);
  if (!t) return [];
  try {
    const part = t.split('.')[1];
    if (!part) return [];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '=');
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return Array.isArray(payload.permissions) ? payload.permissions : [];
  } catch {
    return [];
  }
}

/** True if the realm's token grants the permission (or any of them when given a list). */
export function hasPerm(realm: Realm, perm: string | string[]): boolean {
  const held = new Set(getPermissions(realm));
  return (Array.isArray(perm) ? perm : [perm]).some((p) => held.has(p));
}

function headers(realm?: Realm, json = true): Record<string, string> {
  const h: Record<string, string> = { 'x-tenant-slug': getTenantSlug() };
  if (json) h['Content-Type'] = 'application/json';
  if (realm) {
    const t = getToken(realm);
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

// Signed out → the login page of the panel last used (شعبه → /branch/login, نماینده → /representative/login…).
const loginPath = (realm: Realm): string => (realm === 'super' ? '/admin/login' : panelLogin(realm));

/** On a 401 the stored token is stale/invalid — clear it and bounce to the realm's login instead
 * of surfacing a raw "Invalid or expired token" on an empty panel. */
function onUnauthorized(realm?: Realm) {
  if (!realm || typeof window === 'undefined') return;
  clearToken(realm);
  const login = loginPath(realm);
  if (!window.location.pathname.endsWith('/login')) window.location.href = login;
}

async function handle<T>(res: Response, realm?: Realm): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthorized(realm);
    throw Object.assign(new Error((data as any).message || `خطا (${res.status})`), { code: (data as any).code, status: res.status });
  }
  return data as T;
}

export const client = {
  get: <T>(path: string, realm?: Realm) =>
    fetch(`${BASE}${path}`, { headers: headers(realm, false) }).then((r) => handle<T>(r, realm)),
  post: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r, realm)),
  patch: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'PATCH', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r, realm)),
  put: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'PUT', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r, realm)),
  del: <T>(path: string, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'DELETE', headers: headers(realm, false) }).then((r) => handle<T>(r, realm)),
  postForm: <T>(path: string, form: FormData, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: headers(realm, false), body: form }).then((r) => handle<T>(r, realm)),
  // For file downloads (returns the URL with tenant header handled via a new tab is not possible;
  // caller fetches the blob).
  download: async (path: string, realm: Realm, filename: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: headers(realm, false) });
    if (!res.ok) { if (res.status === 401) onUnauthorized(realm); throw new Error(`خطا (${res.status})`); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  // Multipart upload that reports progress (fetch can't): onProgress gets 0–1 and the estimated seconds left.
  upload: <T>(path: string, form: FormData, realm: Realm, onProgress: (fraction: number, secondsLeft: number | null) => void) =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`);
      Object.entries(headers(realm, false)).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      const started = Date.now();
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const f = e.loaded / e.total;
        const elapsed = (Date.now() - started) / 1000;
        onProgress(f, f > 0.02 && elapsed > 0.3 ? Math.max(0, Math.round((elapsed / f) * (1 - f))) : null);
      };
      xhr.onload = () => {
        let data: any = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(1, 0); resolve(data as T); return; }
        if (xhr.status === 401) onUnauthorized(realm);
        reject(new Error(data.message || `خطا (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره تلاش کنید'));
      xhr.send(form);
    }),
  // POST a JSON body and save the file the server returns (e.g. a report built in the browser → Excel).
  downloadPost: async (path: string, body: unknown, realm: Realm, filename: string) => {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: headers(realm), body: JSON.stringify(body) });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized(realm);
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error((data as any).message || `خطا (${res.status})`), { code: (data as any).code, status: res.status });
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  // Open a protected file inline in a new tab (auth header can't ride on window.open).
  view: async (path: string, realm: Realm) => {
    const res = await fetch(`${BASE}${path}`, { headers: headers(realm, false) });
    if (!res.ok) {
      if (res.status === 401) onUnauthorized(realm);
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error((data as any).message || `خطا (${res.status})`), { code: (data as any).code, status: res.status });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { // popup blocked → fall back to same-tab navigation
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  // Fetch a protected file and return an object URL + mime type for INLINE rendering.
  // The caller owns the URL and must URL.revokeObjectURL() it when done.
  blobUrl: async (path: string, realm: Realm): Promise<{ url: string; mimeType: string }> => {
    const res = await fetch(`${BASE}${path}`, { headers: headers(realm, false) });
    if (!res.ok) { if (res.status === 401) onUnauthorized(realm); throw new Error(`خطا (${res.status})`); }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), mimeType: blob.type };
  },
  base: BASE,
};
