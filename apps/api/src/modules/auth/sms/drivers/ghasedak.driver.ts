import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * Ghasedak (https://ghasedak.me, docs: https://ghasedak.me/docs).
 * Free-text: POST https://api.ghasedak.me/v2/sms/send/simple  header `apikey`
 *   form: message, receptor, linenumber
 * OTP pattern: POST https://api.ghasedak.me/v2/verification/send/simple  header `apikey`
 *   form: receptor, type=1, template=<name>, param1=<code>
 *
 * Config: SMS_API_KEY, SMS_SENDER (linenumber), SMS_OTP_PATTERN (template name) for OTP.
 */
export class GhasedakDriver implements SmsDriver {
  readonly name = 'ghasedak';
  private readonly logger = new Logger('Sms:ghasedak');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.apiKey) throw new Error('ghasedak driver needs SMS_API_KEY');
  }

  async send(toPhone: string, message: string): Promise<void> {
    await this.post('sms/send/simple', {
      message,
      receptor: toLocalMobile(toPhone),
      linenumber: this.cfg.sender,
    });
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    if (this.cfg.otpPattern) {
      await this.post('verification/send/simple', {
        receptor: toLocalMobile(toPhone),
        type: '1',
        template: this.cfg.otpPattern,
        param1: code,
      });
      return;
    }
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  private async post(path: string, fields: Record<string, string>): Promise<void> {
    const res = await fetch(`https://api.ghasedak.me/v2/${path}`, {
      method: 'POST',
      headers: { apikey: this.cfg.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    if (!res.ok) {
      this.logger.error(`Ghasedak failed: HTTP ${res.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }
}
