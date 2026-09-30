import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, CaseStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { branchWhere } from '../../common/tenant/branch-scope';
import { getContext } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';

export interface CaseListQuery {
  status?: CaseStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Whether the caller may see unmasked National IDs on screen. */
  private canSeePii(): boolean {
    return (getContext()?.permissions ?? []).includes(PERMISSIONS.VIEW_PII);
  }

  private nid(enc: string | null): string | null {
    if (!enc) return null;
    const v = this.crypto.decrypt(enc);
    if (!v) return null;
    return this.canSeePii() ? v : `••••••${v.slice(-4)}`;
  }

  async list(query: CaseListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.CaseWhereInput = {
      ...branchWhere(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { caseNumber: { contains: query.q, mode: 'insensitive' } },
              { policy: { policyNumber: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.scoped.case.count({ where }),
      this.prisma.scoped.case.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          insured: { select: { fullName: true, nationalCode: true } },
          policy: { select: { policyNumber: true, carrier: true } },
          beneficiary: { select: { type: true } },
        },
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        status: c.status,
        insuredName: c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) : null,
        nationalCode: this.nid(c.insured?.nationalCode ?? null),
        beneficiaryType: c.beneficiary?.type ?? null,
        policyNumber: c.policy?.policyNumber ?? null,
        carrier: c.policy?.carrier ?? null,
        stageDate: c.stageDate ? toJalali(c.stageDate, false) : null,
        paidAt: c.paidAt ? toJalali(c.paidAt, false) : null,
      })),
    };
  }

  async get(id: string) {
    const c = await this.prisma.scoped.case.findFirst({
      where: { id, ...branchWhere() },
      include: {
        insured: true,
        policy: true,
        beneficiary: true,
        payments: { orderBy: { date: 'desc' } },
        documents: { select: { id: true, kind: true, fileName: true, verificationStatus: true } },
      },
    });
    if (!c) throw new NotFoundException('پرونده یافت نشد');
    await this.audit.record({ action: AuditAction.VIEW, targetType: 'Case', targetId: id });

    return {
      id: c.id,
      caseNumber: c.caseNumber,
      status: c.status,
      insured: {
        fullName: c.insured?.fullName ? this.crypto.decrypt(c.insured.fullName) : null,
        nationalCode: this.nid(c.insured?.nationalCode ?? null),
        dateOfDeath: c.insured?.dateOfDeath ? toJalali(c.insured.dateOfDeath, false) : null,
      },
      beneficiary: c.beneficiary
        ? { type: c.beneficiary.type, fullName: this.crypto.decrypt(c.beneficiary.fullName) }
        : null,
      policy: c.policy,
      workflow: {
        stageDate: this.j(c.stageDate),
        docsRequestedAt: this.j(c.docsRequestedAt),
        docsSentAt: this.j(c.docsSentAt),
        sentToHqAt: this.j(c.sentToHqAt),
        approvedAt: this.j(c.approvedAt),
        paidAt: this.j(c.paidAt),
      },
      documents: c.documents,
      payments: c.payments.map((p) => ({
        date: this.j(p.date),
        amount: p.amount.toString(),
        status: p.status,
        description: p.description,
      })),
    };
  }

  async updateStatus(id: string, status: CaseStatus) {
    const c = await this.prisma.scoped.case.findFirst({ where: { id, ...branchWhere() }, select: { id: true } });
    if (!c) throw new NotFoundException('پرونده یافت نشد');
    const updated = await this.prisma.scoped.case.update({ where: { id }, data: { status } });
    await this.audit.record({ action: AuditAction.EDIT, targetType: 'Case', targetId: id, metadata: { status } });
    return { id: updated.id, status: updated.status };
  }

  private j(d: Date | null): string | null {
    return d ? toJalali(d, false) : null;
  }
}
