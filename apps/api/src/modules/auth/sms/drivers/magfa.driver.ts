import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * Magfa — HTTP API v2 (https://messaging.magfa.com, docs: https://messaging.magfa.com/ui/?public/wiki).
 * Auth: HTTP Basic with username `"<username>/<domain>"` and the account password.
 * Endpoint: POST https://sms.magfa.com/api/http/sms/v2/send
 *   body: { senders:[<sender>], messages:[<text>], recipients:[<09...>] }
 *   success: HTTP 200 with JSON `{ "status": 0, ... }` (0 == accepted).
 *
 * Config: SMS_USERNAME, SMS_PASSWORD, SMS_DOMAIN, SMS_SENDER.
 * Magfa has no separate OTP endpoint in v2 — OTP is a normal send using an approved line/pattern.
 */
export class MagfaDriver implements SmsDriver {
  readonly name = 'magfa';
  private readonly logger = new Logger('Sms:magfa');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.username || !cfg.password || !cfg.domain) {
      throw new Error('magfa driver needs SMS_USERNAME, SMS_PASSWORD and SMS_DOMAIN');
    }
  }

  async send(toPhone: string, message: string): Promise<void> {
    const auth = Buffer.from(`${this.cfg.username}/${this.cfg.domain}:${this.cfg.password}`).toString('base64');
    const res = await fetch('https://sms.magfa.com/api/http/sms/v2/send', {
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
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || (body && typeof body.status === 'number' && body.status !== 0)) {
      this.logger.error(`Magfa send failed: HTTP ${res.status} status=${body?.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, this.cfg.otpMessage(code));
  }
}
