const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api/v1';
const TENANT = process.env.NEXT_PUBLIC_TENANT_SLUG || 'damuon';

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-slug': TENANT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'خطا در ارتباط با سرور');
  return data as T;
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-tenant-slug': TENANT, Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'خطا در ارتباط با سرور');
  return data as T;
}

export const inquiryApi = {
  requestOtp: (nationalCode: string, phone: string) =>
    post<{ ok: boolean; message: string }>('/inquiry/request-otp', { nationalCode, phone }),
  verifyOtp: (nationalCode: string, phone: string, code: string) =>
    post<{ token: string; expiresIn: string }>('/inquiry/verify-otp', {
      nationalCode,
      phone,
      code,
    }),
  getCase: (token: string) => get<any>('/inquiry/case', token),
};
