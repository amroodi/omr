import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from '../auth/sms.service';

/**
 * «پیامک کد پذیرش»: whoever filed a case («کاربر ثبت» — the بیمه‌گزار / نماینده, or an organization's operator on
 * panel 1) gets its «کد پذیرش» by SMS on their own mobile, once. Super Admin switches it on and sets when it
 * is sent (at filing, or at «ثبت نهایی»), through which gateway, and the text.
 */
export interface ReceiptSmsSettings {
  enabled: boolean;
  when: 'FILE' | 'SUBMIT';
  gateway: 'PLATFORM' | 'ORG'; // the platform's (Damuon) or the filer's own organization's
  template: string; // {code} {claimNumber} {name} {org}
}
export const DEFAULT_RECEIPT_SMS: ReceiptSmsSettings = {
  enabled: false, when: 'SUBMIT', gateway: 'PLATFORM',
  template: 'پرونده خسارت {claimNumber} ثبت شد.\nکد پذیرش: {code}\nپیگیری پرونده با کد پذیرش در سامانه.\n{org}',
};

@Injectable()
export class ReceiptSmsService {
  private readonly logger = new Logger(ReceiptSmsService.name);
  constructor(private readonly prisma: PrismaService, private readonly crypto: FieldCryptoService, private readonly sms: SmsService) {}

  async settings(): Promise<ReceiptSmsSettings> {
    const r = await this.prisma.unscoped().platformConfig.findUnique({ where: { id: 'platform' }, select: { receiptSms: true } });
    const o = (r?.receiptSms && typeof r.receiptSms === 'object' ? r.receiptSms : {}) as Partial<ReceiptSmsSettings>;
    return { ...DEFAULT_RECEIPT_SMS, ...o };
  }

  async save(input: Partial<ReceiptSmsSettings>): Promise<ReceiptSmsSettings> {
    const cur = await this.settings();
    const next: ReceiptSmsSettings = {
      enabled: input.enabled ?? cur.enabled,
      when: input.when === 'FILE' || input.when === 'SUBMIT' ? input.when : cur.when,
      gateway: input.gateway === 'ORG' || input.gateway === 'PLATFORM' ? input.gateway : cur.gateway,
      template: input.template !== undefined ? String(input.template).slice(0, 500) : cur.template,
    };
    if (!next.template.includes('{code}')) throw new BadRequestException('متن پیامک باید {code} (کد پذیرش) را داشته باشد');
    const data = { receiptSms: next as unknown as Prisma.InputJsonValue };
    await this.prisma.unscoped().platformConfig.upsert({ where: { id: 'platform' }, update: data, create: { id: 'platform', ...data } });
    return next;
  }

  private text(t: string, v: { code: string; claimNumber: string; name: string; org: string }) {
    return t.replace(/\{code\}/g, v.code).replace(/\{claimNumber\}/g, v.claimNumber).replace(/\{name\}/g, v.name).replace(/\{org\}/g, v.org).replace(/\\n/g, '\n').trim();
  }

  /** Super Admin's test: the text with sample values, to one number, through the chosen gateway. */
  async test(phone: string, tenantId?: string) {
    const s = await this.settings();
    const msg = this.text(s.template, { code: '12345678', claimNumber: '1405/0/01', name: 'نمونه', org: 'سامانه دامون' });
    if (s.gateway === 'ORG' && tenantId) await this.sms.send(phone, msg, tenantId); else await this.sms.sendViaPlatform(phone, msg);
    return { ok: true, text: msg };
  }

  /**
   * At «moment» (FILE or SUBMIT): when on and set for that moment, send the case's code to whoever filed it —
   * once per case. Never throws into the filing: a missing number or a gateway error is only logged.
   */
  async sendFor(claimId: string, moment: 'FILE' | 'SUBMIT'): Promise<void> {
    try {
      const s = await this.settings();
      if (!s.enabled || s.when !== moment) return;
      const db = this.prisma.unscoped();
      const c = await db.claim.findUnique({ where: { id: claimId }, select: { id: true, receiptCode: true, receiptSmsAt: true, claimNumber: true, filedById: true, filedByKind: true, deceasedFullName: true, insurerTenantId: true, brokerTenantId: true } });
      if (!c?.receiptCode || c.receiptSmsAt || !c.filedById) return;
      let phone: string | null = null; let tenantId: string | null = null;
      if (c.filedByKind === 'ORG_USER') {
        const u = await db.orgUser.findUnique({ where: { id: c.filedById }, select: { phone: true, tenantId: true } });
        phone = u?.phone ? this.crypto.decrypt(u.phone) : null; tenantId = u?.tenantId ?? null;
      } else {
        const a = await db.customerAccount.findUnique({ where: { id: c.filedById }, select: { phone: true, tenantId: true } });
        phone = a?.phone ? this.crypto.decrypt(a.phone) : null; tenantId = a?.tenantId ?? null;
      }
      if (!phone) { this.logger.warn(`receipt SMS: no mobile for the filer of ${c.claimNumber}`); return; }
      const org = tenantId ? (await db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name ?? '' : '';
      const msg = this.text(s.template, { code: c.receiptCode, claimNumber: c.claimNumber, name: c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) ?? '' : '', org });
      if (s.gateway === 'ORG' && tenantId) await this.sms.send(phone, msg, tenantId); else await this.sms.sendViaPlatform(phone, msg);
      await db.claim.update({ where: { id: claimId }, data: { receiptSmsAt: new Date() } });
    } catch (e) {
      this.logger.error(`receipt SMS failed for ${claimId}: ${String(e).slice(0, 200)}`);
    }
  }
}
