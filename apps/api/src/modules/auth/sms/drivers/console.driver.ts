import { Logger } from '@nestjs/common';
import { SmsConfig, SmsDriver } from '../sms-driver';

/**
 * Dev/test driver: logs instead of sending, so OTP flows work without a provider account.
 * Prints at log level (not debug) so codes are visible in normal logs. NEVER use in production.
 */
export class ConsoleDriver implements SmsDriver {
  readonly name = 'console';
  private readonly logger = new Logger('Sms:console');

  constructor(private readonly cfg: SmsConfig) {}

  async send(toPhone: string, message: string): Promise<void> {
    this.logger.log(`[SMS:console] -> ${this.mask(toPhone)}: ${message}`);
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  private mask(phone: string): string {
    return phone.length <= 4 ? '••••' : `${'•'.repeat(phone.length - 4)}${phone.slice(-4)}`;
  }
}
