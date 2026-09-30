import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, VerificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listByCase(caseId: string) {
    return this.prisma.scoped.document.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    });
  }

  /** The assessor's work queue: documents awaiting authenticity assessment. */
  pendingQueue() {
    return this.prisma.scoped.document.findMany({
      where: { verificationStatus: VerificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: this.publicSelect(),
    });
  }

  /** Record an assessor's authenticity/integrity decision on a document. */
  async verify(id: string, status: VerificationStatus, note?: string) {
    const doc = await this.prisma.scoped.document.findFirst({ where: { id } });
    if (!doc) throw new NotFoundException('سند یافت نشد');

    const assessorId = getContext()?.actorId ?? null;
    const updated = await this.prisma.scoped.document.update({
      where: { id },
      data: {
        verificationStatus: status,
        verifiedById: assessorId,
        verifiedAt: new Date(),
        verificationNote: note ?? null,
      },
      select: this.publicSelect(),
    });

    await this.audit.record({
      action: AuditAction.EDIT,
      targetType: 'Document',
      targetId: id,
      metadata: { verificationStatus: status, note },
    });
    return updated;
  }

  private publicSelect() {
    return {
      id: true,
      kind: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      ocrStatus: true,
      verificationStatus: true,
      verifiedById: true,
      verifiedAt: true,
      verificationNote: true,
      caseId: true,
      createdAt: true,
    } as const;
  }
}
