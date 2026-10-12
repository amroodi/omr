import { Logger } from '@nestjs/common';
import { BasicAuthSecurity, createClientAsync } from 'soap';
import { SmsConfig, SmsDriver, toIntlMobile } from '../sms-driver';
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

    // Magfa SOAP `send` — 7 array parts in this exact order (names/order read from the live WSDL):
    // messages, senders, recipients, uids, encodings, udhs, priorities. Each wrapped as <item>.
    // The optional four are empty so Magfa auto-detects encoding (required for Persian). Recipients
    // must be in 98… form (no "+", no leading 0).
    const args = {
      messages: { item: [message] },
      senders: { item: [this.cfg.sender] },
      recipients: { item: [toIntlMobile(toPhone)] },
      uids: { item: [] as number[] },
      encodings: { item: [] as number[] },
      udhs: { item: [] as string[] },
      priorities: { item: [] as number[] },
    };
    let result: any;
    try {
      const res = await client.sendAsync(args);
      result = Array.isArray(res) ? res[0] : res;
    } catch (e) {
      this.logger.error(`Magfa SOAP fault: ${String((e as Error).message)}`);
      throw new Error(`مگفا (SOAP): ${String((e as Error).message).slice(0, 200)}`);
    }

    // Log the raw response once per send — Magfa's accept/reject only shows here, and "accepted
    // request / rejected message" (bad sender, no credit, unapproved text) is otherwise silent.
    this.logger.log(`Magfa SOAP response: ${JSON.stringify(result).slice(0, 500)}`);

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

  /**
   * The SOAP response shape varies. Magfa v2 returns a top-level request `status` (0 = accepted)
   * AND a per-recipient result. Both must be OK: a request can be accepted (status 0) while the
   * single message is rejected (invalid sender/recipient, no credit, unapproved text). Per recipient
   * Magfa returns either a positive dispatch id (queued/OK) or a NEGATIVE/non-zero error status.
   */
  private extractStatus(result: any): number | null {
    if (!result || typeof result !== 'object') return null;
    // Magfa may return the status as a number OR a numeric string ("29"); coerce both.
    const toNum = (v: any): number | null =>
      typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;

    // 1) Top-level request status — any non-zero is an error (18/19/22/29/12/…).
    const top = [result.status, result?.return?.status, result?.result?.status].map(toNum).find((n) => n !== null);
    if (typeof top === 'number' && top !== 0) return top;

    // 2) Per-recipient result. SOAP wraps arrays as {item:[…]}.
    const msgs = result.messages ?? result?.return?.messages ?? result?.result?.messages ?? result?.return ?? result?.result;
    const arr = Array.isArray(msgs) ? msgs : Array.isArray(msgs?.item) ? msgs.item : null;
    if (arr && arr.length) {
      const first = arr[0];
      const n = toNum(first);
      if (n !== null) return n < 0 ? n : 0; // positive = dispatch id (OK)
      const ms = toNum(first?.status);
      if (ms !== null) return ms;
    }
    return typeof top === 'number' ? top : null;
  }
}
