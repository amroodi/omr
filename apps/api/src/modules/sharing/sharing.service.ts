import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, SharingScope } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';

/**
 * Cross-organization data sharing. Sharing is opt-in and revocable, and is NEVER wired into the
 * default query scope — partners read shared data only through endpoints that call assertAccess()
 * first, so the strict per-tenant isolation of every normal query is preserved.
 */
@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Agreements where the caller's tenant is the owner (data they share out). */
  listOutgoing() {
    const tenantId = getTenantIdOrThrow();
    return this.prisma.unscoped().dataSharingAgreement.findMany({
      where: { ownerTenantId: tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Agreements where the caller's tenant is the partner (data shared with them). */
  listIncoming() {
    const tenantId = getTenantIdOrThrow();
    return this.prisma.unscoped().dataSharingAgreement.findMany({
      where: { partnerTenantId: tenantId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The caller's tenant grants a partner tenant access to the caller's own data. */
  async grant(partnerTenantId: string, scope: SharingScope, note?: string) {
    const ownerTenantId = getTenantIdOrThrow();
    if (partnerTenantId === ownerTenantId) throw new BadRequestException('سازمان نمی‌تواند به خودش دسترسی دهد');

    const partner = await this.prisma.unscoped().tenant.findUnique({ where: { id: partnerTenantId }, select: { id: true, isActive: true } });
    if (!partner || !partner.isActive) throw new NotFoundException('سازمان مقصد یافت نشد');

    const agreement = await this.prisma.unscoped().dataSharingAgreement.upsert({
      where: { ownerTenantId_partnerTenantId_scope: { ownerTenantId, partnerTenantId, scope } },
      update: { isActive: true, revokedAt: null, revokedBy: null, note },
      create: { ownerTenantId, partnerTenantId, scope, note, createdBy: getContext()?.actorId ?? null },
    });
    await this.audit.record({ action: AuditAction.SHARE_GRANT, tenantId: ownerTenantId, targetType: 'Tenant', targetId: partnerTenantId, metadata: { scope } });
    return agreement;
  }

  /** The owner revokes a previously granted agreement. Immediate. */
  async revoke(id: string) {
    const ownerTenantId = getTenantIdOrThrow();
    const agreement = await this.prisma.unscoped().dataSharingAgreement.findUnique({ where: { id } });
    if (!agreement || agreement.ownerTenantId !== ownerTenantId) throw new NotFoundException('توافق یافت نشد');

    const updated = await this.prisma.unscoped().dataSharingAgreement.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date(), revokedBy: getContext()?.actorId ?? null },
    });
    await this.audit.record({ action: AuditAction.SHARE_REVOKE, tenantId: ownerTenantId, targetType: 'Tenant', targetId: agreement.partnerTenantId, metadata: { scope: agreement.scope } });
    return updated;
  }

  /**
   * Guard for partner-facing cross-tenant reads: throws unless `partnerTenantId` has an active
   * agreement of at least `required` scope to read `ownerTenantId`'s data. FULL satisfies any
   * requirement; CASE_STATUS satisfies only CASE_STATUS.
   */
  async assertAccess(ownerTenantId: string, partnerTenantId: string, required: SharingScope): Promise<void> {
    const agreements = await this.prisma.unscoped().dataSharingAgreement.findMany({
      where: { ownerTenantId, partnerTenantId, isActive: true },
      select: { scope: true },
    });
    const scopes = new Set(agreements.map((a) => a.scope));
    const ok = scopes.has(SharingScope.FULL) || scopes.has(required);
    if (!ok) throw new ForbiddenException('دسترسی اشتراکی بین این دو سازمان فعال نیست');
  }
}
