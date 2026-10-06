import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * Melipayamak / Payamak-panel REST (https://www.melipayamak.com, docs: https://rest.payamak-panel.com).
 * Free-text: POST https://rest.payamak-panel.com/api/SendSMS/SendSMS  { username, password, to, from, text }
 * OTP pattern: POST https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber
 *   { username, password, text:<code>, to, bodyId:<approved pattern id> }
 *
 * Config: SMS_USERNAME, SMS_PASSWORD, SMS_SENDER (from), SMS_OTP_PATTERN (numeric bodyId) for OTP.
 */
export class MelipayamakDriver implements SmsDriver {
  readonly name = 'melipayamak';
  private readonly logger = new Logger('Sms:melipayamak');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.username || !cfg.password) throw new Error('melipayamak driver needs SMS_USERNAME and SMS_PASSWORD');
  }

  async send(toPhone: string, message: string): Promise<void> {
    await this.post('SendSMS', {
      username: this.cfg.username,
      password: this.cfg.password,
      to: toLocalMobile(toPhone),
      from: this.cfg.sender,
      text: message,
    });
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    if (this.cfg.otpPattern) {
      await this.post('BaseServiceNumber', {
        username: this.cfg.username,
        password: this.cfg.password,
        text: code,
        to: toLocalMobile(toPhone),
        bodyId: Number(this.cfg.otpPattern),
      });
      return;
    }
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://rest.payamak-panel.com/api/SendSMS/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.error(`Melipayamak failed: HTTP ${res.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }
}
