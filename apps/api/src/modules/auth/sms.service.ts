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
        // Never log the recipient's full number in production.
        this.logger.debug(`[SMS:console] -> ${this.mask(toPhone)}: ${message}`);
        return;
      // case 'kavenegar': return this.sendKavenegar(toPhone, message);
      default:
        throw new Error(`SMS driver "${this.driver}" not implemented`);
    }
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, `کد تایید سامانه بیمس: ${code}\nاین کد را در اختیار دیگران قرار ندهید.`);
  }

  private mask(phone: string): string {
    return phone.length <= 4 ? '••••' : `${'•'.repeat(phone.length - 4)}${phone.slice(-4)}`;
  }
}
