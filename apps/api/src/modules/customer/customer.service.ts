import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';

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
