import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * Kavenegar (https://kavenegar.com, docs: https://kavenegar.com/rest.html).
 * Free-text: GET/POST https://api.kavenegar.com/v1/{APIKEY}/sms/send.json?receptor=&message=&sender=
 * OTP pattern: https://api.kavenegar.com/v1/{APIKEY}/verify/lookup.json?receptor=&token=<code>&template=<name>
 *   (the template must be approved in the panel; it contains the %token placeholder).
 *
 * Config: SMS_API_KEY, SMS_SENDER, and SMS_OTP_PATTERN (template name) to use verify/lookup for OTP.
 */
export class KavenegarDriver implements SmsDriver {
  readonly name = 'kavenegar';
  private readonly logger = new Logger('Sms:kavenegar');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.apiKey) throw new Error('kavenegar driver needs SMS_API_KEY');
  }

  async send(toPhone: string, message: string): Promise<void> {
    const params = new URLSearchParams({
      receptor: toLocalMobile(toPhone),
      message,
      ...(this.cfg.sender ? { sender: this.cfg.sender } : {}),
    });
    await this.call(`sms/send.json?${params.toString()}`);
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    if (this.cfg.otpPattern) {
      const params = new URLSearchParams({ receptor: toLocalMobile(toPhone), token: code, template: this.cfg.otpPattern });
      await this.call(`verify/lookup.json?${params.toString()}`);
      return;
    }
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  private async call(path: string): Promise<void> {
    const res = await fetch(`https://api.kavenegar.com/v1/${this.cfg.apiKey}/${path}`, { method: 'POST' });
    if (!res.ok) {
      this.logger.error(`Kavenegar failed: HTTP ${res.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }
}
