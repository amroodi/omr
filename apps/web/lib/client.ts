'use client';

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

function headers(realm?: Realm, json = true): Record<string, string> {
  const h: Record<string, string> = { 'x-tenant-slug': getTenantSlug() };
  if (json) h['Content-Type'] = 'application/json';
  if (realm) {
    const t = getToken(realm);
    if (t) h.Authorization = `Bearer ${t}`;
  }
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).message || `خطا (${res.status})`);
  return data as T;
}

export const client = {
  get: <T>(path: string, realm?: Realm) =>
    fetch(`${BASE}${path}`, { headers: headers(realm, false) }).then((r) => handle<T>(r)),
  post: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  patch: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'PATCH', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  put: <T>(path: string, body: unknown, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'PUT', headers: headers(realm), body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  del: <T>(path: string, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'DELETE', headers: headers(realm, false) }).then((r) => handle<T>(r)),
  postForm: <T>(path: string, form: FormData, realm?: Realm) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: headers(realm, false), body: form }).then((r) => handle<T>(r)),
  // For file downloads (returns the URL with tenant header handled via a new tab is not possible;
  // caller fetches the blob).
  download: async (path: string, realm: Realm, filename: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: headers(realm, false) });
    if (!res.ok) throw new Error(`خطا (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  base: BASE,
};
