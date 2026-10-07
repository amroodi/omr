import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * Magfa — HTTP API v2 (docs: https://messaging.magfa.com/ui/?public/wiki).
 * Auth: HTTP Basic, username = "<username>/<domain>", password = account password.
 * Endpoint: POST https://sms.magfa.com/api/http/sms/v2/send
 *   body: { senders:[<sender>], messages:[<text>], recipients:[<recipient>]}
 *   success: HTTP 200 with JSON { "status": 0, messages:[{status:0,id:...}] }.
 *
 * Config: SMS_USERNAME, SMS_PASSWORD, SMS_DOMAIN, SMS_SENDER.
 */
// Official Magfa `status` meanings (HTTP/SOAP v2) — surfaced to the operator for quick diagnosis.
export const MAGFA_STATUS: Record<number, string> = {
  0: 'موفق',
  1: 'شماره گیرنده نادرست است',
  2: 'شماره فرستنده نادرست است',
  3: 'پارامتر encoding نامعتبر است',
  4: 'پارامتر mclass نامعتبر است',
  6: 'پارامتر UDH نامعتبر است',
  12: 'اعتبار/شارژ کافی نیست',
  13: 'محتوای پیامک خالی است',
  14: 'مانده اعتبار ریالی کافی نیست',
  16: 'حساب غیرفعال است',
  18: 'نام کاربری و/یا کلمه عبور نامعتبر است',
  19: 'درخواست معتبر نیست (اغلب رمز نادرست وب‌سرویس)',
  22: 'سرویس (وب‌سرویس) فعال نشده است — باید از سمت مگفا فعال شود',
  29: 'آدرس سرور (IP) مجاز نیست — IP سرور را در پنل مگفا مجاز کنید',
};

export class MagfaDriver implements SmsDriver {
  readonly name = 'magfa';
  private readonly logger = new Logger('Sms:magfa');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.username || !cfg.password || !cfg.domain) {
      throw new Error('درایور مگفا به نام کاربری، رمز عبور و دامنه نیاز دارد');
    }
    if (!cfg.sender) throw new Error('شماره خط فرستنده (SMS_SENDER) برای مگفا لازم است');
  }

  async send(toPhone: string, message: string): Promise<void> {
    const auth = Buffer.from(`${this.cfg.username}/${this.cfg.domain}:${this.cfg.password}`).toString('base64');
    let res: Response;
    try {
      res = await fetch('https://sms.magfa.com/api/http/sms/v2/send', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'cache-control': 'no-cache',
        },
        body: JSON.stringify({
          senders: [this.cfg.sender],
          messages: [message],
          recipients: [toLocalMobile(toPhone)],
        }),
      });
    } catch (e) {
      throw new Error(`اتصال به مگفا برقرار نشد (${String((e as Error).message)}) — اتصال/فیلترینگ سرور را بررسی کنید`);
    }

    const raw = await res.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* non-JSON response */ }

    const top = typeof body?.status === 'number' ? body.status : undefined;
    const msgStatus = Array.isArray(body?.messages) ? body.messages[0]?.status : undefined;

    // Success = HTTP ok AND Magfa top-level status 0. Anything else is surfaced with detail.
    if (!res.ok || top !== 0) {
      const hint = top !== undefined && MAGFA_STATUS[top] ? ` — ${MAGFA_STATUS[top]}` : '';
      const detail = `مگفا: HTTP ${res.status}، status=${top ?? 'نامشخص'}${msgStatus !== undefined ? `، وضعیت پیام=${msgStatus}` : ''}${hint}`;
      this.logger.error(`${detail} | body=${raw.slice(0, 300)}`);
      throw new Error(`${detail}${!body ? ` | پاسخ: ${raw.slice(0, 160)}` : ''}`);
    }
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, this.cfg.otpMessage(code));
  }
}
