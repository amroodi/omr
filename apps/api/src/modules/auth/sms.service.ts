import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SMS gateway abstraction. The `console` driver (default in dev) logs the message instead of
 * sending it, so OTP flows are testable without a provider. Implement a real Iranian provider
 * (Kavenegar, Ghasedak, …) by adding a branch in `send()` keyed on SMS_DRIVER — the interface
 * stays the same.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly driver: string;

  constructor(private readonly config: ConfigService) {
    this.driver = this.config.get<string>('SMS_DRIVER', 'console');
  }

  async send(toPhone: string, message: string): Promise<void> {
    switch (this.driver) {
      case 'console':
        // Dev/test driver: print at log level so OTP codes are visible without enabling debug logs.
        // Never log the recipient's full number. Switch SMS_DRIVER to a real gateway in production.
        this.logger.log(`[SMS:console] -> ${this.mask(toPhone)}: ${message}`);
        return;
      case 'kavenegar':
        return this.sendKavenegar(toPhone, message);
      default:
        throw new Error(`SMS driver "${this.driver}" not implemented`);
    }
  }

  /** Kavenegar (Iranian SMS gateway). Set SMS_API_KEY and SMS_SENDER. */
  private async sendKavenegar(toPhone: string, message: string): Promise<void> {
    const apiKey = this.config.get<string>('SMS_API_KEY', '');
    const sender = this.config.get<string>('SMS_SENDER', '');
    if (!apiKey) throw new Error('SMS_API_KEY is not set for the kavenegar driver');
    const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json`;
    const params = new URLSearchParams({ receptor: toPhone, message, ...(sender ? { sender } : {}) });
    const res = await fetch(`${url}?${params.toString()}`, { method: 'POST' });
    if (!res.ok) {
      this.logger.error(`Kavenegar send failed: HTTP ${res.status}`);
      throw new Error('ارسال پیامک ناموفق بود');
    }
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, `کد تایید سامانه بیمس: ${code}\nاین کد را در اختیار دیگران قرار ندهید.`);
  }

  private mask(phone: string): string {
    return phone.length <= 4 ? '••••' : `${'•'.repeat(phone.length - 4)}${phone.slice(-4)}`;
  }
}
