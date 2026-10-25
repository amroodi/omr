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

export const API_BASE = BASE;

export interface CompanyHit { id: string; name: string; hasLogo: boolean }

export const inquiryApi = {
  // استعلام سریع: nationalCode = DECEASED's کد ملی (any company's case);
  // phone = the CHECKER's own mobile (OTP target, and how «پاسخگوی آنلاین» answers them).
  searchCompanies: async (q: string): Promise<CompanyHit[]> => {
    const res = await fetch(`${BASE}/policyholder-companies/search?q=${encodeURIComponent(q)}`, { headers: { 'x-tenant-slug': TENANT } });
    return res.ok ? res.json() : [];
  },
  requestClaim: (nationalCode: string, phone: string) =>
    post<{ ok: boolean; message: string; otpRequired?: boolean }>('/inquiry/request-claim', { nationalCode, phone }),
  verifyOtp: (nationalCode: string, phone: string, code: string) =>
    post<{ token: string; expiresIn: string }>('/inquiry/verify-otp', { nationalCode, phone, code }),
  // Direct claim view when OTP is disabled platform-wide (no code).
  directClaim: (nationalCode: string, phone: string) =>
    post<{ token: string; expiresIn: string }>('/inquiry/claim-direct', { nationalCode, phone }),
  getCase: (token: string) => get<any>('/inquiry/case', token),
  // «پاسخگوی آنلاین» — leave a question on the looked-up claim (record token from the inquiry).
  message: (token: string, message: string) => post<{ ok: boolean; message: string }>('/inquiry/message', { message }, token),
};
