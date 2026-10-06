import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

const STATUS_LABELS: Record<ClaimStatus, string> = {
  DRAFT: 'پیش‌نویس',
  SUBMITTED: 'ثبت‌شده',
  UNDER_REVIEW: 'در حال بررسی',
  RETURNED_INCOMPLETE: 'نقص مدارک',
  APPROVED: 'تایید‌شده',
  REJECTED: 'رد‌شده',
  PAID: 'پرداخت‌شده',
};

/**
 * Server-to-server claim lookup for a customer's own backend. Deliberately minimal: returns only
 * non-PII status, verified by (claimNumber + the claimant's National ID), scoped to the key's tenant,
 * rate-limited and audited. No names, amounts, or documents are ever returned here.
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async claimStatus(claimNumber: string, nationalCode: string) {
    const tenantId = getTenantIdOrThrow();
    const ip = getContext()?.ip ?? 'unknown';
    const keyId = getContext()?.actorId ?? 'unknown';
    if (!claimNumber?.trim() || !nationalCode?.trim()) {
      throw new BadRequestException('شماره پرونده و کد ملی الزامی است');
    }
    // Rate limit per key and per IP to prevent enumeration of claim numbers.
    if (!this.rateLimit.hit(`partner:key:${keyId}`, 120, 3600) || !this.rateLimit.hit(`partner:ip:${ip}`, 120, 3600)) {
      throw new BadRequestException('تعداد درخواست‌ها زیاد است');
    }

    const nidHash = this.crypto.blindIndex(nationalCode.trim());
    // Claim is cross-tenant; match the number + claimant NID, constrained to the key's tenant
    // (as insurer or broker). Un-scoped client because Claim isn't a tenant-scoped model.
    const claim = await this.prisma.unscoped().claim.findFirst({
      where: {
        claimNumber: claimNumber.trim(),
        deceasedNationalCodeHash: nidHash ?? '__nomatch__',
        OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }],
      },
      select: {
        id: true,
        claimNumber: true,
        status: true,
        claimType: true,
        updatedAt: true,
        noticeDeadline: true,
        deficiencies: { where: { resolvedAt: null }, select: { items: true } },
      },
    });

    await this.audit.record({
      action: AuditAction.VIEW,
      targetType: 'Claim',
      targetId: claim?.id,
      tenantId,
      actorType: 'API',
      metadata: { endpoint: 'partner/claim-status', matched: !!claim },
    });

    // Same "not found" for a missing claim and a wrong NID — never reveal which.
    if (!claim) throw new NotFoundException('پرونده‌ای با این مشخصات یافت نشد');

    const openDeficiencies = claim.deficiencies.flatMap((d) => d.items ?? []);
    return {
      claimNumber: claim.claimNumber,
      status: claim.status,
      statusLabel: STATUS_LABELS[claim.status],
      claimType: claim.claimType,
      lastUpdated: claim.updatedAt,
      noticeDeadline: claim.noticeDeadline,
      ...(claim.status === ClaimStatus.RETURNED_INCOMPLETE ? { missingDocuments: openDeficiencies } : {}),
    };
  }
}
