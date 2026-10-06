import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';

/**
 * SMS.ir — API v1 (https://sms.ir, docs: https://app.sms.ir/developer/help).
 * Auth: header `X-API-KEY`.
 * Free-text: POST https://api.sms.ir/v1/send/bulk  { lineNumber, messageText, mobiles:[] }
 * OTP verify: POST https://api.sms.ir/v1/send/verify  { mobile, templateId, parameters:[{name,value}] }
 *   (templateId is the numeric id of an approved template whose placeholder matches the param name).
 *
 * Config: SMS_API_KEY, SMS_SENDER (numeric lineNumber), SMS_OTP_TEMPLATE_ID for OTP.
 * The OTP template parameter name defaults to CODE — change it to match your template.
 */
export class SmsIrDriver implements SmsDriver {
  readonly name = 'smsir';
  private readonly logger = new Logger('Sms:smsir');

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.apiKey) throw new Error('smsir driver needs SMS_API_KEY');
  }

  async send(toPhone: string, message: string): Promise<void> {
    await this.post('send/bulk', {
      lineNumber: this.cfg.sender,
      messageText: message,
      mobiles: [toLocalMobile(toPhone)],
    });
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    if (this.cfg.otpTemplateId) {
      await this.post('send/verify', {
        mobile: toLocalMobile(toPhone),
        templateId: Number(this.cfg.otpTemplateId),
        parameters: [{ name: 'CODE', value: code }],
      });
      return;
    }
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`https://api.sms.ir/v1/${path}`, {
      method: 'POST',
      headers: { 'X-API-KEY': this.cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.error(`SMS.ir failed: HTTP ${res.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }
}
