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
// Top-level Magfa `status` meanings (common ones) — surfaced to the operator for quick diagnosis.
const MAGFA_STATUS: Record<number, string> = {
  1: 'شناسه کاربری یا رمز عبور نادرست است',
  2: 'کاربر غیرفعال است',
  3: 'محدودیت تعداد پیام',
  4: 'سقف اعتبار/شارژ کافی نیست',
  6: 'سامانه در حال بروزرسانی است',
  7: 'شماره فرستنده (خط) نامعتبر است',
  13: 'محتوای پیام خالی است',
  14: 'سقف مجاز طول پیام',
  15: 'شماره فرستنده تأیید نشده است',
  16: 'گیرنده‌ای یافت نشد / شماره گیرنده نادرست است',
  17: 'متن پیام حاوی کلمه فیلترشده است',
  18: 'اعتبار کافی نیست',
  22: 'این سرویس از طرف اپراتور مسدود است',
  33: 'شماره فرستنده متعلق به این حساب نیست',
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
