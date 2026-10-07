import { Logger } from '@nestjs/common';
import { BasicAuthSecurity, createClientAsync } from 'soap';
import { SmsConfig, SmsDriver, toLocalMobile } from '../sms-driver';
import { MAGFA_STATUS } from './magfa.driver';

/**
 * Magfa — SOAP API v2. Same account/credentials as the HTTP driver, different protocol.
 * WSDL:   https://webservice.magfa.com/api/soap/sms/v2/server?wsdl
 * Auth:   HTTP Basic (username "<username>/<domain>" when a domain is set, else username).
 * Op:     send(messages[], senders[], recipients[]).
 *
 * Uses the `soap` package so the envelope/namespace come from the live WSDL (no hand-written XML).
 * The WSDL is fetched once per driver instance and cached. Application-level failures are surfaced
 * with the Magfa status code + hint, like the HTTP driver.
 */
const WSDL = 'https://webservice.magfa.com/api/soap/sms/v2/server?wsdl';

export class MagfaSoapDriver implements SmsDriver {
  readonly name = 'magfa-soap';
  private readonly logger = new Logger('Sms:magfa-soap');
  private clientPromise: Promise<any> | null = null;

  constructor(private readonly cfg: SmsConfig) {
    if (!cfg.username || !cfg.password) throw new Error('درایور مگفا (SOAP) به نام کاربری و رمز وب‌سرویس نیاز دارد');
    if (!cfg.sender) throw new Error('شماره خط فرستنده (SMS_SENDER) برای مگفا لازم است');
  }

  private client(): Promise<any> {
    if (!this.clientPromise) {
      const basicUser = this.cfg.domain ? `${this.cfg.username}/${this.cfg.domain}` : this.cfg.username;
      this.clientPromise = createClientAsync(WSDL).then((c: any) => {
        c.setSecurity(new BasicAuthSecurity(basicUser, this.cfg.password));
        return c;
      });
    }
    return this.clientPromise;
  }

  async send(toPhone: string, message: string): Promise<void> {
    let client: any;
    try {
      client = await this.client();
    } catch (e) {
      this.clientPromise = null; // allow retry after a transient WSDL fetch failure
      throw new Error(`اتصال به وب‌سرویس SOAP مگفا ناموفق بود: ${String((e as Error).message).slice(0, 160)}`);
    }

    const args = { messages: [message], senders: [this.cfg.sender], recipients: [toLocalMobile(toPhone)] };
    let result: any;
    try {
      const res = await client.sendAsync(args);
      result = Array.isArray(res) ? res[0] : res;
    } catch (e) {
      this.logger.error(`Magfa SOAP fault: ${String((e as Error).message)}`);
      throw new Error(`مگفا (SOAP): ${String((e as Error).message).slice(0, 200)}`);
    }

    const status = this.extractStatus(result);
    if (status !== null && status !== 0) {
      const hint = MAGFA_STATUS[status] ? ` — ${MAGFA_STATUS[status]}` : '';
      this.logger.error(`Magfa SOAP status=${status} | ${JSON.stringify(result).slice(0, 300)}`);
      throw new Error(`مگفا (SOAP): status=${status}${hint}`);
    }
  }

  async sendOtp(toPhone: string, code: string): Promise<void> {
    await this.send(toPhone, this.cfg.otpMessage(code));
  }

  /** The SOAP response shape can vary; look for a numeric status at the common locations. */
  private extractStatus(result: any): number | null {
    if (!result || typeof result !== 'object') return null;
    const candidates = [result.status, result?.return?.status, result?.result?.status];
    for (const c of candidates) if (typeof c === 'number') return c;
    const arr = result.messages ?? result?.return?.messages ?? result?.result?.messages;
    if (Array.isArray(arr) && arr[0] && typeof arr[0].status === 'number') return arr[0].status;
    return null;
  }
}
