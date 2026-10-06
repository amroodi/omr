/**
 * SMS driver contract. Every provider implements this. Add a new provider by creating a file in
 * ./drivers that exports a class implementing SmsDriver, then register it in sms.service.ts.
 *
 * IMPORTANT (Iran): most gateways require OTP/service text to use a pre-approved *pattern/template*
 * ("الگو") sent via a dedicated verify endpoint — free-text send to arbitrary recipients is often
 * blocked or filtered for service messages. Each driver therefore implements `sendOtp` separately:
 * it uses the provider's pattern/verify API when the relevant config is set, and only falls back to
 * free-text `send` otherwise. Configure the pattern/template id per provider (see api.env.example).
 */
export interface SmsDriver {
  readonly name: string;
  /** Free-text message (notifications). */
  send(toPhone: string, message: string): Promise<void>;
  /** OTP code — uses the provider's approved pattern when configured. */
  sendOtp(toPhone: string, code: string): Promise<void>;
}

/** Everything a driver might need, read once from env by the facade. */
export interface SmsConfig {
  sender: string; // line number / sender id
  apiKey: string; // token-based providers (kavenegar, ghasedak, sms.ir)
  username: string; // credential-based providers (magfa, melipayamak)
  password: string;
  domain: string; // magfa account domain
  otpPattern: string; // template name / bodyId for pattern-based OTP
  otpTemplateId: string; // numeric template id (sms.ir)
  otpMessage: (code: string) => string; // free-text fallback body
}

/** Normalize any Iranian mobile input to local form: 09xxxxxxxxx. */
export function toLocalMobile(phone: string): string {
  let p = (phone || '').replace(/\D/g, '');
  if (p.startsWith('0098')) p = p.slice(4);
  else if (p.startsWith('98') && p.length === 12) p = p.slice(2);
  if (p.length === 10 && p.startsWith('9')) p = '0' + p;
  return p;
}

/** Normalize to international form without +: 989xxxxxxxxx. */
export function toIntlMobile(phone: string): string {
  const local = toLocalMobile(phone);
  return local.startsWith('0') ? '98' + local.slice(1) : local;
}
