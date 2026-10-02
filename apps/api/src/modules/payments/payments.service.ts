import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PaymentApproval, PaymentStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { branchWhere } from '../../common/tenant/branch-scope';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';

interface ProposeInput {
  caseId: string;
  amount: string;
  date?: string;
  description?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Maker proposes a payout. It is inert until a different user approves it. */
  async propose(input: ProposeInput) {
    const tenantId = getTenantIdOrThrow();
    const kase = await this.prisma.scoped.case.findFirst({ where: { id: input.caseId, ...branchWhere() }, select: { id: true } });
    if (!kase) throw new NotFoundException('پرونده یافت نشد');

    const payment = await this.prisma.scoped.payment.create({
      data: {
        tenantId,
        caseId: input.caseId,
        amount: input.amount,
        date: input.date ? new Date(input.date) : new Date(),
        description: input.description ?? null,
        status: PaymentStatus.PENDING,
        approval: PaymentApproval.PENDING_APPROVAL,
        proposedById: getContext()?.actorId ?? null,
      },
    });
    await this.audit.record({ action: AuditAction.PAYMENT_PROPOSE, targetType: 'Payment', targetId: payment.id, metadata: { caseId: input.caseId, amount: input.amount } });
    return this.present(payment);
  }

  /** Payouts awaiting a second-person approval. */
  async pendingApprovals() {
    const rows = await this.prisma.scoped.payment.findMany({
      where: { approval: PaymentApproval.PENDING_APPROVAL, ...this.caseBranchFilter() },
      orderBy: { createdAt: 'asc' },
      include: { case: { select: { caseNumber: true } } },
    });
    return rows.map((r) => ({ ...this.present(r), caseNumber: r.case.caseNumber }));
  }

  /** Approve a proposed payout. The proposer cannot approve their own (four-eyes). */
  async approve(id: string, note?: string) {
    const p = await this.load(id);
    if (p.approval !== PaymentApproval.PENDING_APPROVAL) {
      throw new BadRequestException('این پرداخت قبلاً بررسی شده است');
    }
    if (p.proposedById && p.proposedById === getContext()?.actorId) {
      throw new ForbiddenException('پیشنهاددهنده نمی‌تواند پرداخت خود را تایید کند');
    }
    const updated = await this.prisma.scoped.payment.update({
      where: { id },
      data: {
        approval: PaymentApproval.APPROVED,
        status: PaymentStatus.PAID,
        approvedById: getContext()?.actorId ?? null,
        decidedAt: new Date(),
        approvalNote: note ?? null,
      },
    });
    await this.audit.record({ action: AuditAction.PAYMENT_APPROVE, targetType: 'Payment', targetId: id, metadata: { amount: updated.amount.toString() } });
    return this.present(updated);
  }

  async reject(id: string, note?: string) {
    const p = await this.load(id);
    if (p.approval !== PaymentApproval.PENDING_APPROVAL) {
      throw new BadRequestException('این پرداخت قبلاً بررسی شده است');
    }
    if (p.proposedById && p.proposedById === getContext()?.actorId) {
      throw new ForbiddenException('پیشنهاددهنده نمی‌تواند پرداخت خود را رد کند');
    }
    const updated = await this.prisma.scoped.payment.update({
      where: { id },
      data: {
        approval: PaymentApproval.REJECTED,
        approvedById: getContext()?.actorId ?? null,
        decidedAt: new Date(),
        approvalNote: note ?? null,
      },
    });
    await this.audit.record({ action: AuditAction.PAYMENT_REJECT, targetType: 'Payment', targetId: id });
    return this.present(updated);
  }

  listByCase(caseId: string) {
    return this.prisma.scoped.payment
      .findMany({ where: { caseId }, orderBy: { date: 'desc' } })
      .then((rows) => rows.map((r) => this.present(r)));
  }

  private async load(id: string) {
    const p = await this.prisma.scoped.payment.findFirst({ where: { id, ...this.caseBranchFilter() } });
    if (!p) throw new NotFoundException('پرداخت یافت نشد');
    return p;
  }

  /** Restrict payments to the caller's branch (via the owning case) when branch-scoped. */
  private caseBranchFilter() {
    const bw = branchWhere();
    return bw.branchId ? { case: { branchId: bw.branchId } } : {};
  }

  private present(p: any) {
    return {
      id: p.id,
      caseId: p.caseId,
      amount: p.amount.toString(),
      date: toJalali(p.date, false),
      description: p.description,
      status: p.status,
      approval: p.approval,
      proposedById: p.proposedById,
      approvedById: p.approvedById,
      decidedAt: p.decidedAt ? toJalali(p.decidedAt) : null,
      approvalNote: p.approvalNote,
    };
  }
}
