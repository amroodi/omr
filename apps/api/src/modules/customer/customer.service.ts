import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toAsciiDigits, toJalali } from '../../common/jalali/jalali.util';

/**
 * Customer dashboard data. A logged-in customer sees only cases where they are the insured or a
 * beneficiary — matched by their nationalCodeHash from the token, within their own tenant.
 */
@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  // ── Org-side بیمه‌گزار onboarding (tenant-scoped) ──
  async createAccount(input: { nationalCode: string; phone: string; fullName?: string }) {
    const tenantId = getTenantIdOrThrow();
    const nid = toAsciiDigits(input.nationalCode).trim();
    const phone = toAsciiDigits(input.phone).trim();
    if (!/^\d{10}$/.test(nid)) throw new BadRequestException('کد ملی باید ۱۰ رقم باشد');
    if (!/^0?9\d{9}$/.test(phone)) throw new BadRequestException('شماره موبایل نامعتبر است');
    const nidHash = this.crypto.blindIndex(nid)!;
    if (await this.prisma.scoped.customerAccount.findFirst({ where: { nationalCodeHash: nidHash } })) {
      throw new BadRequestException('بیمه‌گزار با این کد ملی قبلاً ثبت شده است');
    }
    const acc = await this.prisma.scoped.customerAccount.create({
      data: {
        tenantId,
        nationalCode: this.crypto.encrypt(nid)!,
        nationalCodeHash: nidHash,
        fullName: input.fullName ? this.crypto.encrypt(input.fullName) : null,
        phone: this.crypto.encrypt(phone),
        phoneHash: this.crypto.blindIndex(phone),
      },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.CREATE, targetType: 'CustomerAccount', targetId: acc.id });
    return { id: acc.id, ok: true };
  }

  async listAccounts() {
    const rows = await this.prisma.scoped.customerAccount.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((r) => {
      const nid = this.crypto.decrypt(r.nationalCode) ?? '';
      return {
        id: r.id,
        fullName: r.fullName ? this.crypto.decrypt(r.fullName) : null,
        nationalCodeMasked: nid ? `••••••${nid.slice(-4)}` : null,
        isActive: r.isActive,
        lastLoginAt: r.lastLoginAt ? toJalali(r.lastLoginAt) : null,
      };
    });
  }

  async myCases(): Promise<unknown[]> {
    const nidHash = getContext()?.customerNidHash;
    if (!nidHash) throw new ForbiddenException('توکن نامعتبر است.');

    const cases = await this.prisma.scoped.case.findMany({
      where: {
        OR: [
          { insured: { nationalCodeHash: nidHash } },
          { beneficiary: { nationalCodeHash: nidHash } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        insured: { select: { fullName: true, nationalCode: true } },
        policy: { select: { policyNumber: true, carrier: true, status: true } },
        payments: { orderBy: { date: 'desc' }, take: 5 },
      },
    });

    await this.audit.record({ action: AuditAction.VIEW, targetType: 'CustomerCases', metadata: { count: cases.length } });

    return cases.map((c) => this.present(c));
  }

  private present(c: any): unknown {
    const nid = c.insured?.nationalCode ? this.crypto.decrypt(c.insured.nationalCode) : null;
    return {
      caseNumber: c.caseNumber,
      status: c.status,
      insuredName: c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) : null,
      nationalCodeMasked: nid ? `••••••${nid.slice(-4)}` : null,
      policy: c.policy ?? null,
      stageDate: c.stageDate ? toJalali(c.stageDate, false) : null,
      paidAt: c.paidAt ? toJalali(c.paidAt, false) : null,
      recentPayments: (c.payments ?? []).map((p: any) => ({
        date: toJalali(p.date, false),
        amount: p.amount?.toString(),
        status: p.status,
      })),
    };
  }
}
