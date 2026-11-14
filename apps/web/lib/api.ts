import { track } from './busy';
const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000/api/v1';
const TENANT = process.env.NEXT_PUBLIC_TENANT_SLUG || 'damuon';

function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return track(path, rawPost<T>(path, body, token), 'POST');
}
async function rawPost<T>(path: string, body: unknown, token?: string): Promise<T> {
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

function get<T>(path: string, token: string): Promise<T> {
  return track(path, rawGet<T>(path, token));
}
async function rawGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-tenant-slug': TENANT, Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'خطا در ارتباط با سرور');
  return data as T;
}

export const API_BASE = BASE;

/** «گفتگو» of the looked-up case: the requester's questions and the کارگزاری's answers. */
export interface InquiryThread { brokerName: string; messages: { id: string; fromStaff: boolean; message: string; at: string; answered: boolean }[]; askPhone?: boolean }

export interface CompanyHit { id: string; name: string; hasLogo: boolean }

/** One case the looked-up کد ملی covers (panel 3 lists them when there is more than one). */
export interface InquiryCase { id: string; claimNumber: string; status: string; name: string | null; relation: string; line: string | null; claimType: string; insurerName: string | null; eventDate: string | null }

/** The case picked on the result page (several when a main insured's family has cases); null = the newest. */
export function pickedClaim(): string | null {
  try { return sessionStorage.getItem('inquiryClaimId'); } catch { return null; }
}
const pick = (id?: string | null, prefix = '?') => (id ? `${prefix}claimId=${encodeURIComponent(id)}` : '');

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
  // Panel 3 login: کد ملی + mobile (OTP), or کد ملی + password (Super Admin's switch).
  loginConfig: async (): Promise<{ phone: boolean; otp: boolean }> => {
    const res = await fetch(`${BASE}/inquiry/login-config`, { headers: { 'x-tenant-slug': TENANT } });
    return res.ok ? res.json() : { phone: true, otp: true };
  },
  passwordLogin: (nationalCode: string, password: string) =>
    post<{ token: string; expiresIn: string }>('/inquiry/password-login', { nationalCode, password }),
  changePassword: (token: string, current: string, next: string) => post<{ ok: boolean }>('/inquiry/password', { current, next }, token),
  getCase: (token: string, claimId?: string | null) => get<any>(`/inquiry/case${pick(claimId)}`, token),
  listCases: (token: string) => get<InquiryCase[]>('/inquiry/cases', token),
  // «پاسخگوی آنلاین» — leave a question on the looked-up claim (record token from the inquiry).
  message: (token: string, message: string, claimId?: string | null, phone?: string) => post<{ ok: boolean; message: string }>('/inquiry/message', { message, ...(claimId ? { claimId } : {}), ...(phone ? { phone } : {}) }, token),
  thread: (token: string, claimId?: string | null, phone?: string) =>
    get<InquiryThread>(`/inquiry/messages${pick(claimId)}${phone ? `${claimId ? '&' : '?'}phone=${encodeURIComponent(phone)}` : ''}`, token),
};
