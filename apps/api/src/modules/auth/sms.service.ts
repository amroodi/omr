import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsConfig, SmsDriver } from './sms/sms-driver';
import { ConsoleDriver } from './sms/drivers/console.driver';
import { GhasedakDriver } from './sms/drivers/ghasedak.driver';
import { KavenegarDriver } from './sms/drivers/kavenegar.driver';
import { MagfaDriver } from './sms/drivers/magfa.driver';
import { MelipayamakDriver } from './sms/drivers/melipayamak.driver';
import { SmsIrDriver } from './sms/drivers/smsir.driver';

/** Each deployment (one per organization's VPS) selects its provider via SMS_DRIVER. */
type DriverFactory = (cfg: SmsConfig) => SmsDriver;

const REGISTRY: Record<string, DriverFactory> = {
  console: (c) => new ConsoleDriver(c),
  magfa: (c) => new MagfaDriver(c),
  kavenegar: (c) => new KavenegarDriver(c),
  ghasedak: (c) => new GhasedakDriver(c),
  smsir: (c) => new SmsIrDriver(c),
  melipayamak: (c) => new MelipayamakDriver(c),
};

/**
 * SMS gateway facade. Picks a provider driver from SMS_DRIVER at startup. Adding a provider =
 * one file in ./sms/drivers + one line in REGISTRY. OTP uses each provider's approved-pattern
 * endpoint when configured (see sms-driver.ts); otherwise it falls back to a free-text message.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly driver: SmsDriver;

  constructor(private readonly config: ConfigService) {
    const name = this.config.get<string>('SMS_DRIVER', 'console').trim();
    const factory = REGISTRY[name];
    if (!factory) {
      throw new Error(`SMS_DRIVER "${name}" is not supported. Available: ${Object.keys(REGISTRY).join(', ')}`);
    }
    this.driver = factory(this.buildConfig());
    this.logger.log(`SMS provider: ${this.driver.name}`);
  }

  async send(toPhone: string, message: string): Promise<void> {
    return this.driver.send(toPhone, message);
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    return this.driver.sendOtp(toPhone, code);
  }

  private buildConfig(): SmsConfig {
    const g = (k: string) => this.config.get<string>(k, '') ?? '';
    return {
      sender: g('SMS_SENDER'),
      apiKey: g('SMS_API_KEY'),
      username: g('SMS_USERNAME'),
      password: g('SMS_PASSWORD'),
      domain: g('SMS_DOMAIN'),
      otpPattern: g('SMS_OTP_PATTERN'),
      otpTemplateId: g('SMS_OTP_TEMPLATE_ID'),
      otpMessage: (code: string) => `کد تایید سامانه بیمس: ${code}\nاین کد را در اختیار دیگران قرار ندهید.`,
    };
  }
}
