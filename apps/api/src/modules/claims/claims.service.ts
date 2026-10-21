import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimStatus, ClaimType, Prisma, SalesChannel } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';
import { OcrService } from '../../integrations/ocr/ocr.service';
import { ClaimFieldsService } from '../claim-fields/claim-fields.service';
import { NotificationsService } from '../notifications/notifications.service';

const CLAIM_DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

// How long a soft-deleted claim stays restorable before the daily purge removes it for good.
export const CLAIM_RETENTION_DAYS = 14;

// The three claim approval checkpoints (کارگزاری / شعبه / ستاد).
type ReviewStageName = 'BROKER' | 'BRANCH' | 'COUNCIL';
type ReviewStateName = 'PENDING' | 'APPROVED' | 'REJECTED';

const DOC_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  VERIFIED: 'تاییدشده',
  REJECTED: 'ردشده',
  NEEDS_INFO: 'نیاز به اصلاح/ارسال مجدد',
};

interface FileClaimInput {
  insurerTenantId: string;
  channel: SalesChannel;
  brokerTenantId?: string; // BROKER channel
  sellingBranchId?: string; // DIRECT channel (insurer branch)
  claimType?: ClaimType;
  eventDate?: string; // ISO date of the death/accident
  policyNumber?: string;
  claimedAmount?: string;
  description?: string; // free-text details (used when بیمه‌گزار files, can't know amount/policy)
  deceasedFullName: string;
  deceasedNationalCode: string;
  policyHolderId?: string;
}

export type Decision = 'ENDORSE' | 'RETURN_INCOMPLETE' | 'REJECT';

/**
 * Death-claim routing engine. See docs/CLAIMS-WORKFLOW.md.
 *
 * Claims are cross-tenant, so this uses the UN-scoped client with explicit access checks:
 * an org user may act only on a step whose holderTenantId equals their tenant; the بیمه‌گزار
 * (customer realm) may act only on a POLICYHOLDER step of their own claim.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCryptoService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly fields: ClaimFieldsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Notification helpers (in-panel + SMS via the relevant org's gateway) ──
  private async notifyOrg(tenantId: string, title: string, body: string, link = '/org/claims') {
    await this.notifications.notify({ tenantId, audience: 'ORG', title, body, link });
  }

  private async notifyPolicyHolder(policyHolderId: string | null | undefined, title: string, body: string) {
    if (!policyHolderId) return;
    const acc = await this.prisma.unscoped().customerAccount.findUnique({ where: { id: policyHolderId }, select: { tenantId: true } });
    if (!acc) return;
    await this.notifications.notify({ tenantId: acc.tenantId, audience: 'CUSTOMER', recipientId: policyHolderId, title, body, link: '/customer' });
  }

  private db() {
    return this.prisma.unscoped();
  }

  // ─────────────────────────── Filing ───────────────────────────
  async file(input: FileClaimInput) {
    const db = this.db();
    const insurer = await db.tenant.findUnique({ where: { id: input.insurerTenantId }, select: { id: true, kind: true, noticeDays: true } });
    if (!insurer || insurer.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');

    // 30-day (configurable) notice deadline: event date + insurer.noticeDays.
    const eventDate = input.eventDate ? new Date(input.eventDate) : null;
    let noticeDeadline: Date | null = null;
    let lateNotice = false;
    if (eventDate) {
      noticeDeadline = new Date(eventDate.getTime() + insurer.noticeDays * 24 * 60 * 60 * 1000);
      lateNotice = new Date() > noticeDeadline;
    }

    let moarefTenantId: string;
    let moarefBranchId: string | null = null;
    let moarefRole: string;
    if (input.channel === 'BROKER') {
      // Default the معرف broker to the caller's own tenant (a broker filing on behalf).
      input.brokerTenantId = input.brokerTenantId ?? getContext()?.tenantId;
      if (!input.brokerTenantId) throw new BadRequestException('کارگزار (معرف) الزامی است');
      const broker = await db.tenant.findUnique({ where: { id: input.brokerTenantId }, select: { kind: true } });
      if (!broker || broker.kind !== 'BROKER') throw new BadRequestException('کارگزار نامعتبر است');
      // A brokerage may only file against an insurer it is partnered with.
      const partner = await db.brokerInsurerPartnership.findFirst({ where: { brokerTenantId: input.brokerTenantId, insurerTenantId: input.insurerTenantId, isActive: true }, select: { id: true } });
      if (!partner) throw new BadRequestException('این کارگزاری با این بیمه‌گر همکاری فعال ندارد');
      moarefTenantId = input.brokerTenantId;
      moarefRole = 'MOAREF_BROKER';
    } else {
      if (!input.sellingBranchId) throw new BadRequestException('شعبه فروشنده (معرف) الزامی است');
      const branch = await db.branch.findFirst({ where: { id: input.sellingBranchId, tenantId: input.insurerTenantId }, select: { id: true } });
      if (!branch) throw new BadRequestException('شعبه فروشنده متعلق به بیمه‌گر نیست');
      moarefTenantId = input.insurerTenantId;
      moarefBranchId = input.sellingBranchId;
      moarefRole = 'MOAREF_BRANCH';
    }

    const nid = input.deceasedNationalCode;
    const claimNumber = await this.newClaimNumber();
    const claim = await db.claim.create({
      data: {
        claimNumber,
        insurerTenantId: input.insurerTenantId,
        channel: input.channel,
        brokerTenantId: input.channel === 'BROKER' ? input.brokerTenantId : null,
        sellingBranchId: moarefBranchId,
        policyHolderId: input.policyHolderId ?? getContext()?.actorId ?? null,
        deceasedFullName: this.crypto.encrypt(input.deceasedFullName)!,
        deceasedNationalCode: this.crypto.encrypt(nid)!,
        deceasedNationalCodeHash: this.crypto.blindIndex(nid)!,
        claimType: input.claimType ?? 'DEATH_ILLNESS',
        eventDate,
        noticeDeadline,
        lateNotice,
        policyNumber: input.policyNumber ?? null,
        claimedAmount: input.claimedAmount ?? '0',
        description: input.description ?? null,
        status: ClaimStatus.UNDER_REVIEW,
        participants: {
          create: [
            { tenantId: input.insurerTenantId, role: 'INSURER' },
            ...(input.channel === 'BROKER' ? [{ tenantId: input.brokerTenantId!, role: 'MOAREF_BROKER' }] : []),
          ],
        },
        steps: {
          create: [{ order: 1, partyType: 'MOAREF', holderTenantId: moarefTenantId, holderBranchId: moarefBranchId, state: 'PENDING', direction: 'UP' }],
        },
      },
      include: { steps: true },
    });

    await this.audit.record({ action: AuditAction.CLAIM_SUBMIT, tenantId: input.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { channel: input.channel, moaref: moarefRole } });
    await this.notifyOrg(moarefTenantId, 'پرونده خسارت جدید', `پرونده ${claim.claimNumber} برای بررسی در انتظار شماست.`);
    await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد و در حال بررسی است.`);
    return this.present(claim);
  }

  // ─────────────────────────── Decisions ───────────────────────────
  async decide(claimId: string, decision: Decision, opts: { note?: string; deficiencies?: string[] } = {}) {
    const { claim, step } = await this.loadActive(claimId);
    this.assertStepActor(step, claim);

    if (decision === 'RETURN_INCOMPLETE') return this.returnIncomplete(claim, step, opts.deficiencies ?? [], opts.note);
    if (decision === 'REJECT') {
      if (step.partyType === 'MOAREF') throw new BadRequestException('معرف تنها می‌تواند نقص مدارک اعلام کند');
      return this.reject(claim, step, opts.note);
    }
    // ENDORSE
    if (step.partyType === 'MOAREF') return this.forwardToInsurer(claim, step, opts.note);
    if (step.partyType === 'INSURER_LEVEL') return this.endorseLevel(claim, step, opts.note);
    throw new BadRequestException('این مرحله قابل تصمیم‌گیری نیست');
  }

  private async forwardToInsurer(claim: any, step: any, note?: string) {
    const db = this.db();
    const first = await this.levelAt(claim.insurerTenantId, 1);
    if (!first) throw new BadRequestException('بیمه‌گر هیچ سطح تاییدی تعریف نکرده است');
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'FORWARDED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await this.addStep(claim.id, step.order + 1, 'INSURER_LEVEL', claim.insurerTenantId, { levelId: first.id });
    await this.audit.record({ action: AuditAction.CLAIM_FORWARD, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id });
    await this.notifyOrg(claim.insurerTenantId, 'پرونده برای تایید ارجاع شد', `پرونده ${claim.claimNumber} در سطح بیمه‌گر در انتظار بررسی است.`);
    return this.reload(claim.id);
  }

  private async endorseLevel(claim: any, step: any, note?: string) {
    const db = this.db();
    const level = await db.approvalLevel.findUnique({ where: { id: step.levelId } });
    if (!level) throw new BadRequestException('سطح تایید یافت نشد');
    const amount = new Prisma.Decimal(claim.claimedAmount);
    const withinCeiling = level.ceiling === null || amount.lessThanOrEqualTo(level.ceiling);

    if (withinCeiling) {
      // Authorized here → final approval, decision cascades down.
      await db.claimStep.update({ where: { id: step.id }, data: { state: 'APPROVED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
      await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.APPROVED } });
      await this.audit.record({ action: AuditAction.CLAIM_APPROVE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { levelOrder: level.order } });
      await this.notifyPolicyHolder(claim.policyHolderId, 'تایید پرونده خسارت', `پرونده ${claim.claimNumber} تایید شد.`);
      await this.notifyOrg(claim.insurerTenantId, 'پرونده تایید شد', `پرونده ${claim.claimNumber} تایید نهایی شد و آماده پرداخت است.`);
      return this.reload(claim.id);
    }
    // Beyond this level's authority → escalate strictly to the next level (no skipping).
    const next = await this.levelAt(claim.insurerTenantId, level.order + 1);
    if (!next) throw new BadRequestException('سطح بالاتری برای ارجاع تعریف نشده است');
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'ESCALATED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await this.addStep(claim.id, step.order + 1, 'INSURER_LEVEL', claim.insurerTenantId, { levelId: next.id });
    await this.audit.record({ action: AuditAction.CLAIM_ESCALATE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { from: level.order, to: next.order } });
    await this.notifyOrg(claim.insurerTenantId, 'ارجاع به سطح بالاتر', `پرونده ${claim.claimNumber} برای تایید به سطح بالاتر ارجاع شد.`);
    return this.reload(claim.id);
  }

  private async returnIncomplete(claim: any, step: any, items: string[], note?: string) {
    const db = this.db();
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'RETURNED_INCOMPLETE', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await db.claimDeficiency.create({ data: { claimId: claim.id, raisedByTenantId: getContext()?.tenantId ?? null, raisedByStepId: step.id, items: JSON.stringify(items) } });
    await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.RETURNED_INCOMPLETE } });
    // Hand back to the بیمه‌گزار for رفع نقص.
    await this.addStep(claim.id, step.order + 1, 'POLICYHOLDER', claim.insurerTenantId, { direction: 'DOWN' });
    await this.audit.record({ action: AuditAction.CLAIM_RETURN_INCOMPLETE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { items } });
    await this.notifyPolicyHolder(claim.policyHolderId, 'نقص مدارک پرونده', `برای پرونده ${claim.claimNumber} نقص مدارک اعلام شد؛ برای رفع نقص وارد پنل شوید.`);
    return this.reload(claim.id);
  }

  private async reject(claim: any, step: any, note?: string) {
    const db = this.db();
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'REJECTED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.REJECTED } });
    await this.audit.record({ action: AuditAction.CLAIM_REJECT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id });
    await this.notifyPolicyHolder(claim.policyHolderId, 'رد پرونده خسارت', `پرونده ${claim.claimNumber} رد شد. برای اطلاعات بیشتر با سازمان تماس بگیرید.`);
    return this.reload(claim.id);
  }

  /** بیمه‌گزار resolves deficiencies and resubmits — restarts the FULL chain (no skipping). */
  async rectify(claimId: string, note?: string) {
    const { claim, step } = await this.loadActive(claimId);
    if (step.partyType !== 'POLICYHOLDER') throw new BadRequestException('پرونده در وضعیت رفع نقص نیست');
    this.assertStepActor(step, claim);
    const db = this.db();
    await db.claimDeficiency.updateMany({ where: { claimId: claim.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'FORWARDED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    // Re-enter at معرف — identical to the original entry (full re-review).
    const moarefTenantId = claim.channel === 'BROKER' ? claim.brokerTenantId! : claim.insurerTenantId;
    await this.addStep(claim.id, step.order + 1, 'MOAREF', moarefTenantId, { holderBranchId: claim.sellingBranchId });
    await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.UNDER_REVIEW } });
    await this.audit.record({ action: AuditAction.CLAIM_RECTIFY, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id });
    await this.notifyOrg(moarefTenantId, 'رفع نقص انجام شد', `بیمه‌گزار نقص مدارک پرونده ${claim.claimNumber} را رفع کرد؛ پرونده دوباره در انتظار بررسی است.`);
    return this.reload(claim.id);
  }

  /**
   * Record the finalized damage amount (مبلغ خسارت قطعی) determined after assessment. Distinct from
   * the estimated amount (مبلغ برآوردی = claimedAmount) captured at filing. The payout uses this value
   * once set. Gated by claim:process (the assessing operator — شعبه/ستاد). Audit-logged.
   */
  async setFinalizedAmount(claimId: string, amount: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const normalized = String(amount ?? '').replace(/[^\d.]/g, '');
    if (normalized === '' || isNaN(Number(normalized)) || Number(normalized) < 0) throw new BadRequestException('مبلغ قطعی نامعتبر است');
    await db.claim.update({ where: { id: claimId }, data: { finalizedAmount: new Prisma.Decimal(normalized) } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { finalizedAmount: normalized } });
    return this.reload(claimId);
  }

  /** Insurer's شعبه records the payout after final approval. The معرف (broker) never pays. */
  async markPaid(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const ctx = getContext();
    // Payment is the insurer's (شعبه) responsibility — a brokerage/معرف may review but not pay.
    if (ctx?.actorType === 'ORG_USER' && ctx.tenantId !== claim.insurerTenantId) {
      throw new ForbiddenException('پرداخت توسط کارگزاری (معرف) انجام نمی‌شود؛ پرداخت بر عهدهٔ شعبهٔ بیمه‌گر است');
    }
    if (claim.status !== ClaimStatus.APPROVED) throw new BadRequestException('پرونده تایید نشده است');
    await this.db().claim.update({ where: { id: claimId }, data: { status: ClaimStatus.PAID } });
    await this.audit.record({ action: AuditAction.CLAIM_PAY, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId });
    await this.notifyPolicyHolder(claim.policyHolderId, 'پرداخت خسارت', `خسارت پرونده ${claim.claimNumber} پرداخت شد.`);
    return this.reload(claimId);
  }

  /**
   * Soft-delete a claim: hide it everywhere and mark it for purge after the retention window, but
   * keep the row (and the audit trail) so an admin can UNDO within CLAIM_RETENTION_DAYS. Admin-only
   * (claim:delete) and audit-logged. The permanent removal happens later in purgeExpired().
   */
  async remove(claimId: string) {
    const u = this.prisma.unscoped();
    const claim = await u.claim.findUnique({
      where: { id: claimId },
      select: { id: true, claimNumber: true, insurerTenantId: true, brokerTenantId: true, policyHolderId: true, deletedAt: true },
    });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    if (!claim.deletedAt) {
      await u.claim.update({ where: { id: claimId }, data: { deletedAt: new Date() } });
      await this.audit.record({
        action: AuditAction.DELETE,
        tenantId: claim.insurerTenantId,
        targetType: 'Claim',
        targetId: claimId,
        metadata: { claimNumber: claim.claimNumber, soft: true, retentionDays: CLAIM_RETENTION_DAYS },
      });
    }
    return { deleted: true, retentionDays: CLAIM_RETENTION_DAYS };
  }

  /** Undo a soft-delete while still within the retention window. Audit-logged. */
  async restore(claimId: string) {
    const u = this.prisma.unscoped();
    const claim = await u.claim.findUnique({
      where: { id: claimId },
      select: { id: true, claimNumber: true, insurerTenantId: true, brokerTenantId: true, policyHolderId: true, deletedAt: true },
    });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    if (claim.deletedAt) {
      await u.claim.update({ where: { id: claimId }, data: { deletedAt: null } });
      await this.audit.record({
        action: AuditAction.EDIT,
        tenantId: claim.insurerTenantId,
        targetType: 'Claim',
        targetId: claimId,
        metadata: { claimNumber: claim.claimNumber, restored: true },
      });
    }
    return { restored: true };
  }

  /** Recycle bin: soft-deleted claims the caller may restore, with days left before permanent purge. */
  async listTrash() {
    const ctx = getContext();
    const where =
      ctx?.actorType === 'CUSTOMER'
        ? { policyHolderId: ctx.actorId, deletedAt: { not: null } }
        : { OR: [{ insurerTenantId: ctx?.tenantId }, { brokerTenantId: ctx?.tenantId }], deletedAt: { not: null } };
    const claims = await this.db().claim.findMany({ where, orderBy: { deletedAt: 'desc' } });
    const now = Date.now();
    return claims.map((c) => {
      const base: any = this.present(c);
      const purgeAt = (c.deletedAt ? new Date(c.deletedAt).getTime() : now) + CLAIM_RETENTION_DAYS * 86400000;
      base.deletedAt = c.deletedAt ? toJalali(c.deletedAt) : null;
      base.daysLeft = Math.max(0, Math.ceil((purgeAt - now) / 86400000));
      return base;
    });
  }

  /** Permanently delete claims whose retention window has elapsed (called by the daily purge job). */
  async purgeExpired(): Promise<number> {
    const u = this.prisma.unscoped();
    const cutoff = new Date(Date.now() - CLAIM_RETENTION_DAYS * 86400000);
    const expired = await u.claim.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } });
    for (const c of expired) await this.hardDelete(c.id);
    return expired.length;
  }

  /** Irreversibly delete a claim and ALL its children (+ document files). No DB cascade exists. */
  private async hardDelete(claimId: string) {
    const u = this.prisma.unscoped();
    const docs = await u.document.findMany({ where: { claimId }, select: { storageKey: true } });
    await u.$transaction([
      u.documentReview.deleteMany({ where: { document: { claimId } } }), // FK RESTRICT → before documents
      u.claimFieldValue.deleteMany({ where: { claimId } }),
      u.claimDeficiency.deleteMany({ where: { claimId } }),
      u.claimStep.deleteMany({ where: { claimId } }),
      u.claimParticipant.deleteMany({ where: { claimId } }),
      u.document.deleteMany({ where: { claimId } }),
      u.claim.delete({ where: { id: claimId } }),
    ]);
    for (const d of docs) {
      try { await this.storage.remove(d.storageKey); } catch { /* orphan file is harmless */ }
    }
  }

  // ─────────────────────────── Reads ───────────────────────────
  async get(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const result: any = this.present(claim, true);
    await this.enrichParties(claim, result);
    return result;
  }

  private nidMasked(nid: string | null): string | null {
    if (!nid) return null;
    const canPii = (getContext()?.permissions ?? []).includes('view:pii');
    return canPii ? nid : `••••••${nid.slice(-4)}`;
  }

  /** Resolve every party on a claim to names/branches/levels + who acted, for a traceable workflow. */
  private async enrichParties(claim: any, result: any) {
    const db = this.db();
    const steps: any[] = claim.steps ?? [];
    const tenantIds = [...new Set([claim.insurerTenantId, ...(claim.brokerTenantId ? [claim.brokerTenantId] : []), ...steps.map((s) => s.holderTenantId)].filter(Boolean))];
    const branchIds = [...new Set([...(claim.sellingBranchId ? [claim.sellingBranchId] : []), ...steps.map((s) => s.holderBranchId)].filter(Boolean))] as string[];
    const levelIds = [...new Set(steps.map((s) => s.levelId).filter(Boolean))] as string[];
    const actorIds = [...new Set(steps.map((s) => s.decidedById).filter(Boolean))] as string[];

    const [tenants, branches, levels, orgUsers] = await Promise.all([
      db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, kind: true } }),
      branchIds.length ? db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
      levelIds.length ? db.approvalLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
      actorIds.length ? db.orgUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } }) : Promise.resolve([] as { id: string; displayName: string }[]),
    ]);
    const tMap = new Map(tenants.map((t) => [t.id, t]));
    const bMap = new Map(branches.map((b) => [b.id, b.name]));
    const lMap = new Map(levels.map((l) => [l.id, l.name]));
    const uMap = new Map(orgUsers.map((u) => [u.id, u.displayName]));

    let phPerson: { name: string | null; phone: string | null; nationalCode: string | null } | null = null;
    if (claim.policyHolderId) {
      const ph = await db.customerAccount.findUnique({ where: { id: claim.policyHolderId }, select: { fullName: true, nationalCode: true, phone: true } });
      if (ph) {
        const nid = ph.nationalCode ? this.crypto.decrypt(ph.nationalCode) : null;
        phPerson = {
          name: ph.fullName ? this.crypto.decrypt(ph.fullName) : null,
          phone: ph.phone ? this.crypto.decrypt(ph.phone) : null,
          nationalCode: this.nidMasked(nid),
        };
        result.policyHolder = phPerson;
      }
    }
    const ins = tMap.get(claim.insurerTenantId);
    result.insurer = ins ? { name: ins.name } : null;
    result.broker = claim.brokerTenantId && tMap.get(claim.brokerTenantId) ? { name: tMap.get(claim.brokerTenantId)!.name } : null;
    result.sellingBranchName = claim.sellingBranchId ? (bMap.get(claim.sellingBranchId) ?? null) : null;

    result.steps = (result.steps ?? []).map((s: any, i: number) => {
      const raw = steps[i] ?? {};
      const t = raw.holderTenantId ? tMap.get(raw.holderTenantId) : undefined;
      // A POLICYHOLDER step is held by a PERSON (the claimant), not an org/branch. The stored
      // holderTenantId is only a routing placeholder (the insurer), so surface the person instead.
      const isPolicyHolder = s.partyType === 'POLICYHOLDER';
      return {
        ...s,
        holderName: isPolicyHolder ? (phPerson?.name ?? null) : (t?.name ?? null),
        holderKind: isPolicyHolder ? 'POLICYHOLDER' : (t?.kind ?? null),
        branchName: isPolicyHolder ? null : raw.holderBranchId ? (bMap.get(raw.holderBranchId) ?? null) : null,
        levelName: raw.levelId ? (lMap.get(raw.levelId) ?? null) : null,
        decidedByName: raw.decidedById ? (uMap.get(raw.decidedById) ?? null) : null,
        person: isPolicyHolder ? phPerson : null,
      };
    });
  }

  /** Required-document checklist for a claim, filtered by its cause of death. */
  async checklist(claimId: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);

    const reqs = await db.requiredDocument.findMany({
      where: { tenantId: claim.insurerTenantId, isActive: true, appliesToTypes: { has: claim.claimType } },
      orderBy: { order: 'asc' },
    });
    const docs = await db.document.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, docCode: true, fileName: true, verificationStatus: true, verificationNote: true, createdAt: true, uploadedBy: true },
    });
    const byCode = new Map<string, typeof docs>();
    for (const d of docs) {
      const k = d.docCode ?? '_other';
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k)!.push(d);
    }
    // Per-document approvals at the three checkpoints (کارگزاری/شعبه/ستاد).
    const docReviews = docs.length
      ? await db.documentReview.findMany({ where: { documentId: { in: docs.map((d) => d.id) } } })
      : [];
    const reviewsByDoc = new Map<string, Map<string, string>>();
    for (const r of docReviews) {
      if (!reviewsByDoc.has(r.documentId)) reviewsByDoc.set(r.documentId, new Map());
      reviewsByDoc.get(r.documentId)!.set(r.stage, r.state);
    }
    const applicableStages = (claim.brokerTenantId ? ['BROKER', 'BRANCH', 'COUNCIL'] : ['BRANCH', 'COUNCIL']) as ReviewStageName[];
    const canEditStage: Record<string, boolean> = {
      BROKER: this.canReviewStage(claim, 'BROKER'),
      BRANCH: this.canReviewStage(claim, 'BRANCH'),
      COUNCIL: this.canReviewStage(claim, 'COUNCIL'),
    };
    // Present each docCode's uploads newest-first, with an explicit version number so admins can
    // tell new re-uploads from older ones at a glance. The newest is the "current" version.
    const present = (group: typeof docs) =>
      group.map((d, i) => ({
        id: d.id,
        fileName: d.fileName,
        status: d.verificationStatus,
        statusLabel: DOC_STATUS_LABELS[d.verificationStatus] ?? d.verificationStatus,
        note: d.verificationNote ?? null,
        uploadedAt: d.createdAt ? toJalali(d.createdAt) : null,
        version: group.length - i, // newest has the highest version number
        isLatest: i === 0,
        reviews: applicableStages.map((st) => ({
          stage: st,
          state: reviewsByDoc.get(d.id)?.get(st) ?? 'PENDING',
          canEdit: canEditStage[st],
        })),
      }));
    const items = reqs.map((r) => {
      const group = byCode.get(r.code) ?? [];
      const latest = group[0];
      return {
        code: r.code,
        label: r.label,
        appliesToTypes: r.appliesToTypes,
        uploaded: group.length > 0,
        latestStatus: latest?.verificationStatus ?? null,
        documents: present(group),
      };
    });
    const reqCodes = new Set(reqs.map((r) => r.code));
    return {
      claimType: claim.claimType,
      complete: items.length > 0 && items.every((i) => i.uploaded),
      items,
      otherDocuments: present(docs.filter((d) => !d.docCode || !reqCodes.has(d.docCode))),
    };
  }

  /** Approve / reject / request-info on a claim document. Org participants only (not the بیمه‌گزار). */
  async verifyDocument(claimId: string, docId: string, action: 'approve' | 'reject' | 'needs_info', note?: string) {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER') throw new ForbiddenException('تنها کارشناس سازمان می‌تواند مدارک را بررسی کند');
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const doc = await db.document.findFirst({ where: { id: docId, claimId }, select: { id: true } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const status = action === 'approve' ? 'VERIFIED' : action === 'reject' ? 'REJECTED' : 'NEEDS_INFO';
    await db.document.update({
      where: { id: docId },
      data: { verificationStatus: status as any, verifiedById: ctx?.actorId ?? null, verifiedAt: new Date(), verificationNote: note ?? null },
    });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimDocument', targetId: docId, metadata: { verify: status, note } });
    return { ok: true };
  }

  /**
   * Who may set a given checkpoint's review (all require the doc:verify permission):
   *  - کارگزاری (BROKER): a user of the معرف/broker org on this claim.
   *  - شعبه (BRANCH): an insurer-org user assigned to a branch (OrgUser.branchId set).
   *  - ستاد (COUNCIL): a central insurer-org user (no branch — مدیریت مرکزی / شورای فنی).
   */
  private canReviewStage(claim: any, stage: ReviewStageName): boolean {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER') return false;
    if (!(ctx.permissions ?? []).includes('doc:verify')) return false;
    if (stage === 'BROKER') return !!claim.brokerTenantId && ctx.tenantId === claim.brokerTenantId;
    if (ctx.tenantId !== claim.insurerTenantId) return false;
    if (stage === 'BRANCH') return !!ctx.branchId; // branch operators (شعبه)
    if (stage === 'COUNCIL') return !ctx.branchId; // central management / شورای فنی (ستاد)
    return false;
  }

  /** Set a per-document approval at one checkpoint (کارگزاری/شعبه/ستاد) and roll it up to the doc status. */
  async reviewDocument(claimId: string, docId: string, stage: ReviewStageName, state: ReviewStateName, note?: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    if (!this.canReviewStage(claim, stage)) throw new ForbiddenException('اجازهٔ بررسی این مرحله را ندارید');
    const doc = await db.document.findFirst({ where: { id: docId, claimId }, select: { id: true } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const ctx = getContext();
    const decidedAt = state === 'PENDING' ? null : new Date();
    await db.documentReview.upsert({
      where: { documentId_stage: { documentId: docId, stage: stage as any } },
      update: { state: state as any, reviewerId: ctx?.actorId ?? null, note: note ?? null, decidedAt },
      create: { documentId: docId, stage: stage as any, state: state as any, reviewerId: ctx?.actorId ?? null, note: note ?? null, decidedAt },
    });
    await this.recomputeDocStatus(docId, claim);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimDocumentReview', targetId: docId, metadata: { stage, state, note } });
    return { ok: true };
  }

  /** Roll the applicable checkpoint reviews up into the document's overall verificationStatus. */
  private async recomputeDocStatus(docId: string, claim: any) {
    const db = this.db();
    const reviews = await db.documentReview.findMany({ where: { documentId: docId } });
    const applicable: ReviewStageName[] = claim.brokerTenantId ? ['BROKER', 'BRANCH', 'COUNCIL'] : ['BRANCH', 'COUNCIL'];
    const stateOf = (s: ReviewStageName) => reviews.find((r) => r.stage === s)?.state ?? 'PENDING';
    let status: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'PENDING';
    if (applicable.some((s) => stateOf(s) === 'REJECTED')) status = 'REJECTED';
    else if (applicable.every((s) => stateOf(s) === 'APPROVED')) status = 'VERIFIED';
    await db.document.update({ where: { id: docId }, data: { verificationStatus: status as any } });

    // When every uploaded document has cleared all applicable checkpoints (معرف→شعبه→ستاد), the
    // claim is fully approved and ready for payment by شعبه → advance its status (forward-only).
    if (status === 'VERIFIED' && claim.status === ClaimStatus.UNDER_REVIEW) {
      const docs = await db.document.findMany({ where: { claimId: claim.id }, select: { verificationStatus: true } });
      if (docs.length > 0 && docs.every((d) => d.verificationStatus === 'VERIFIED')) {
        await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.APPROVED } });
        await this.audit.record({ action: AuditAction.CLAIM_APPROVE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { via: 'document-review' } });
        await this.notifyOrg(claim.insurerTenantId, 'پرونده آمادهٔ پرداخت', `همهٔ مراحل ارزیابی پروندهٔ ${claim.claimNumber} تایید شد؛ آمادهٔ پرداخت توسط شعبه است.`);
      }
    }
  }

  /** Upload a document to a claim, tagged with the required-document code it satisfies. */
  async uploadDocument(claimId: string, file: Express.Multer.File, docCode: string) {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (!CLAIM_DOC_MIME.has(file.mimetype)) throw new BadRequestException('فقط PDF، JPG و PNG مجاز است');
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const storageKey = await this.storage.save(claim.insurerTenantId, file.buffer);
    const doc = await db.document.create({
      data: {
        tenantId: claim.insurerTenantId,
        claimId,
        docCode: docCode.trim(),
        kind: 'OTHER',
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedBy: getContext()?.actorId ?? null,
        verificationStatus: 'PENDING',
      },
      select: { id: true, docCode: true, fileName: true },
    });
    await this.audit.record({ action: AuditAction.UPLOAD, tenantId: claim.insurerTenantId, targetType: 'ClaimDocument', targetId: doc.id, metadata: { claimId, docCode } });

    // OCR-assist (shadow mode): extract candidate field values as unconfirmed drafts for review.
    try {
      const result = await this.ocr.extract(file.buffer, file.mimetype, 'OTHER');
      const drafts = Object.entries(result.fields).map(([key, f]) => ({ key, value: f.value, confidence: f.confidence }));
      if (drafts.length) await this.fields.ingestOcrDraft(claimId, doc.id, drafts);
    } catch {
      /* OCR is best-effort; never block the upload */
    }
    return doc;
  }

  /** Decrypted bytes of a claim document, for any party to the claim (cross-tenant). */
  async getDocumentFile(claimId: string, docId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const doc = await db.document.findFirst({ where: { id: docId, claimId }, select: { storageKey: true, mimeType: true, fileName: true } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const buffer = await this.storage.read(doc.storageKey);
    await this.audit.record({ action: AuditAction.VIEW, tenantId: claim.insurerTenantId, targetType: 'ClaimDocumentFile', targetId: docId });
    return { buffer, mimeType: doc.mimeType, fileName: doc.fileName };
  }

  async listDocuments(claimId: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    return db.document.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, docCode: true, fileName: true, mimeType: true, verificationStatus: true, createdAt: true },
    });
  }

  /** All claims the caller participates in, newest first, flagged if their action is needed. */
  async listMine() {
    const ctx = getContext();
    const db = this.db();
    const where =
      ctx?.actorType === 'CUSTOMER'
        ? { policyHolderId: ctx.actorId, deletedAt: null }
        : { deletedAt: null, OR: [{ insurerTenantId: ctx?.tenantId }, { brokerTenantId: ctx?.tenantId }, { participants: { some: { tenantId: ctx?.tenantId } } }] };
    const claims = await db.claim.findMany({ where, orderBy: { updatedAt: 'desc' }, include: { steps: { where: { state: 'PENDING' } } } });
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.needsAction(c) }));
  }

  private needsAction(c: any): boolean {
    const ctx = getContext();
    const pending = (c.steps ?? []).find((s: any) => s.state === 'PENDING');
    if (!pending) return false;
    if (pending.partyType === 'POLICYHOLDER') return ctx?.actorType === 'CUSTOMER' ? c.policyHolderId === ctx.actorId : ctx?.tenantId === c.insurerTenantId || ctx?.tenantId === c.brokerTenantId;
    return ctx?.actorType === 'ORG_USER' && ctx.tenantId === pending.holderTenantId;
  }

  /** Insurers the caller's brokerage is partnered with (only these can be filed against). */
  async listInsurers() {
    const brokerId = getContext()?.tenantId;
    if (!brokerId) return [];
    const parts = await this.db().brokerInsurerPartnership.findMany({ where: { brokerTenantId: brokerId, isActive: true }, select: { insurerTenantId: true } });
    const ids = parts.map((p) => p.insurerTenantId);
    if (ids.length === 0) return [];
    return this.db().tenant.findMany({ where: { id: { in: ids }, kind: 'INSURER', isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } });
  }

  /** Work queue: claims with a PENDING step the caller must act on. */
  async queue() {
    const ctx = getContext();
    const db = this.db();
    if (ctx?.actorType === 'CUSTOMER') {
      const claims = await db.claim.findMany({ where: { policyHolderId: ctx.actorId, deletedAt: null, steps: { some: { state: 'PENDING', partyType: 'POLICYHOLDER' } } }, include: { steps: true } });
      return claims.map((c) => this.present(c));
    }
    const claims = await db.claim.findMany({
      where: { deletedAt: null, steps: { some: { state: 'PENDING', holderTenantId: ctx?.tenantId } } },
      include: { steps: true },
    });
    return claims.map((c) => this.present(c));
  }

  /** Claim scope visible to the caller (insurer/broker/participant), excluding soft-deleted. */
  private wdScope(tenantId: string | undefined): Prisma.ClaimWhereInput {
    return { deletedAt: null, OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }, { participants: { some: { tenantId: tenantId ?? undefined } } }] };
  }

  /**
   * The authenticity-review checkpoint this operator owns (see canReviewStage):
   *  - a brokerage (معرف) tenant → BROKER (کارگزاری, the 1st filter);
   *  - an insurer BRANCH user (شعبه, 2nd filter + the one that pays) → BRANCH;
   *  - a central insurer user (ستاد / شورای فنی, final filter) → COUNCIL.
   */
  private async operatorStage(): Promise<ReviewStageName> {
    const ctx = getContext();
    if (!ctx?.tenantId) return 'COUNCIL';
    const tenant = await this.db().tenant.findUnique({ where: { id: ctx.tenantId }, select: { kind: true } });
    if (tenant?.kind === 'BROKER') return 'BROKER';
    return ctx.branchId ? 'BRANCH' : 'COUNCIL';
  }

  /**
   * Classify every in-scope ACTIVE claim into its current pipeline bucket, following the sequential
   * approval filters معرف → شعبه → ستاد → (آماده پرداخت). A claim sits in the first applicable stage
   * that has NOT yet approved all its documents; once every applicable stage has approved, it is READY
   * for payment. Claims with no broker skip the معرف filter (شعبه → ستاد). Rejected-at-a-stage and
   * doc-less claims are left out (they belong to the نقص / filing flows, not a review queue).
   */
  private async pipelineClassify(scope: Prisma.ClaimWhereInput): Promise<Record<'BROKER' | 'BRANCH' | 'COUNCIL' | 'READY', string[]>> {
    const db = this.db();
    const res = { BROKER: [] as string[], BRANCH: [] as string[], COUNCIL: [] as string[], READY: [] as string[] };
    const claims = await db.claim.findMany({
      where: { AND: [scope, { status: { in: [ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW, ClaimStatus.APPROVED] } }] },
      select: { id: true, brokerTenantId: true },
    });
    if (!claims.length) return res;
    const ids = claims.map((c) => c.id);
    const docs = await db.document.findMany({ where: { claimId: { in: ids } }, select: { id: true, claimId: true } });
    const reviews = docs.length ? await db.documentReview.findMany({ where: { documentId: { in: docs.map((d) => d.id) } }, select: { documentId: true, stage: true, state: true } }) : [];
    const docsByClaim = new Map<string, string[]>();
    for (const d of docs) {
      if (!d.claimId) continue;
      if (!docsByClaim.has(d.claimId)) docsByClaim.set(d.claimId, []);
      docsByClaim.get(d.claimId)!.push(d.id);
    }
    const revByDoc = new Map<string, Map<string, string>>();
    for (const r of reviews) {
      if (!revByDoc.has(r.documentId)) revByDoc.set(r.documentId, new Map());
      revByDoc.get(r.documentId)!.set(r.stage, r.state);
    }
    for (const c of claims) {
      const cd = docsByClaim.get(c.id) ?? [];
      if (!cd.length) continue; // nothing uploaded yet → not in a review queue
      const applicable: ReviewStageName[] = c.brokerTenantId ? ['BROKER', 'BRANCH', 'COUNCIL'] : ['BRANCH', 'COUNCIL'];
      const approved = (s: ReviewStageName) => cd.every((d) => revByDoc.get(d)?.get(s) === 'APPROVED');
      const rejected = (s: ReviewStageName) => cd.some((d) => revByDoc.get(d)?.get(s) === 'REJECTED');
      if (applicable.some((s) => rejected(s))) continue; // a rejection pulls it out of the forward pipeline
      const pending = applicable.find((s) => !approved(s));
      if (!pending) res.READY.push(c.id);
      else res[pending].push(c.id);
    }
    return res;
  }

  /**
   * میز کار (Work Desk): the full case pipeline as work-queue tiles with live counts + a summary.
   * Every role sees the whole pipeline (معرف → شعبه → ستاد → در انتظار پرداخت → پرداخت‌شده, plus نقص and
   * همه) scoped to their own claims, so they can track a case end-to-end; `actionable` marks the
   * stage(s) THIS operator may actually act on (معرف→معرف, شعبه→شعبه+پرداخت, ستاد→ستاد).
   */
  async workDesk() {
    const ctx = getContext();
    const db = this.db();
    const tenantId = ctx?.tenantId;
    const perms = new Set(ctx?.permissions ?? []);
    const has = (p: string) => perms.has(p);
    const scope = this.wdScope(tenantId);
    const stage = await this.operatorStage();
    const roleLabel = { BROKER: 'معرف (کارگزاری)', BRANCH: 'شعبه', COUNCIL: 'ستاد (شورای فنی)' }[stage];

    type Tile = { key: string; label: string; count: number; actionable: boolean; href?: string };
    const tiles: Tile[] = [];
    if (has('claim:read')) {
      const buckets = await this.pipelineClassify(scope);
      const [allCount, paidCount, returnedCount] = await Promise.all([
        db.claim.count({ where: scope }),
        db.claim.count({ where: { AND: [scope, { status: ClaimStatus.PAID }] } }),
        db.claim.count({ where: { AND: [scope, { status: ClaimStatus.RETURNED_INCOMPLETE }] } }),
      ]);
      tiles.push({ key: 'all', label: 'همه پرونده‌ها', count: allCount, actionable: false, href: '/org/claims' });
      tiles.push({ key: 'stage-broker', label: 'در انتظار ارزیابی معرف (کارگزاری)', count: buckets.BROKER.length, actionable: stage === 'BROKER' });
      tiles.push({ key: 'stage-branch', label: 'در انتظار ارزیابی شعبه (کارشناس شعبه)', count: buckets.BRANCH.length, actionable: stage === 'BRANCH' });
      tiles.push({ key: 'stage-council', label: 'در انتظار ارزیابی ستاد (شورای فنی)', count: buckets.COUNCIL.length, actionable: stage === 'COUNCIL' });
      tiles.push({ key: 'to-pay', label: 'در انتظار پرداخت', count: buckets.READY.length, actionable: stage === 'BRANCH' });
      tiles.push({ key: 'paid', label: 'پرداخت‌شده', count: paidCount, actionable: false, href: '/org/claims' });
      tiles.push({ key: 'returned', label: 'نقص مدارک (عودت‌شده)', count: returnedCount, actionable: false });
    }

    const pendingActions = tiles.filter((t) => t.actionable).reduce((s, t) => s + t.count, 0);
    const user = ctx?.actorId ? await db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { displayName: true, username: true } }) : null;
    return {
      userName: user?.displayName || user?.username || null,
      role: stage,
      roleLabel,
      tiles,
      summary: { pendingActions, queues: tiles.filter((t) => t.actionable && t.count > 0).length },
    };
  }

  /** The claim list for one Work Desk queue (for the tile → list view). */
  async workDeskQueue(key: string) {
    const db = this.db();
    const scope = this.wdScope(getContext()?.tenantId);
    const pipelineKey: Record<string, 'BROKER' | 'BRANCH' | 'COUNCIL' | 'READY'> = {
      'stage-broker': 'BROKER', 'stage-branch': 'BRANCH', 'stage-council': 'COUNCIL', 'to-pay': 'READY',
    };
    let where: Prisma.ClaimWhereInput;
    if (pipelineKey[key]) {
      const buckets = await this.pipelineClassify(scope);
      const ids = buckets[pipelineKey[key]];
      where = { id: { in: ids.length ? ids : ['__none__'] } };
    } else if (key === 'all') where = scope;
    else if (key === 'returned') where = { AND: [scope, { status: ClaimStatus.RETURNED_INCOMPLETE }] };
    else if (key === 'paid') where = { AND: [scope, { status: ClaimStatus.PAID }] };
    else throw new BadRequestException('صف نامعتبر است');
    const claims = await db.claim.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: false }));
  }

  /**
   * Advanced search (جستجوی پیشرفته) over the caller's claims. Indexable fields filter in SQL;
   * the deceased's national code matches via its blind index (exact), and name is matched by
   * decrypting within the already-scoped result set. Dates/amounts accept from–to ranges.
   */
  async searchClaims(q: Record<string, string | undefined>) {
    const db = this.db();
    const and: Prisma.ClaimWhereInput[] = [this.wdScope(getContext()?.tenantId)];
    const clean = (s?: string) => (s ?? '').trim();

    if (clean(q.claimNumber)) and.push({ claimNumber: { contains: clean(q.claimNumber), mode: 'insensitive' } });
    if (clean(q.deceasedNationalCode)) {
      const h = this.crypto.blindIndex(clean(q.deceasedNationalCode).replace(/\D/g, ''));
      if (h) and.push({ deceasedNationalCodeHash: h });
    }
    if (clean(q.insurerTenantId)) and.push({ insurerTenantId: clean(q.insurerTenantId) });
    if (clean(q.brokerTenantId)) and.push({ brokerTenantId: clean(q.brokerTenantId) });
    if (q.claimType && (ClaimType as any)[q.claimType]) and.push({ claimType: q.claimType as ClaimType });
    if (q.status && (ClaimStatus as any)[q.status]) and.push({ status: q.status as ClaimStatus });
    if (q.channel && (SalesChannel as any)[q.channel]) and.push({ channel: q.channel as SalesChannel });

    const dateRange = (field: 'eventDate' | 'createdAt', from?: string, to?: string) => {
      const r: Prisma.DateTimeFilter = {};
      if (clean(from)) r.gte = new Date(clean(from));
      if (clean(to)) r.lte = new Date(clean(to));
      if (Object.keys(r).length) and.push({ [field]: r } as Prisma.ClaimWhereInput);
    };
    dateRange('eventDate', q.eventFrom, q.eventTo);
    dateRange('createdAt', q.createdFrom, q.createdTo);

    const dec = (s?: string) => { const v = clean(s).replace(/[^\d.]/g, ''); return v ? new Prisma.Decimal(v) : undefined; };
    const amtRange = (field: 'claimedAmount' | 'finalizedAmount', min?: string, max?: string) => {
      const r: Prisma.DecimalFilter = {};
      const a = dec(min); const b = dec(max);
      if (a) r.gte = a; if (b) r.lte = b;
      if (Object.keys(r).length) and.push({ [field]: r } as Prisma.ClaimWhereInput);
    };
    amtRange('claimedAmount', q.estMin, q.estMax);
    amtRange('finalizedAmount', q.finMin, q.finMax);

    let claims = await db.claim.findMany({ where: { AND: and }, orderBy: { updatedAt: 'desc' }, take: 300 });
    if (clean(q.deceasedName)) {
      const term = clean(q.deceasedName);
      claims = claims.filter((c) => { const n = c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : ''; return (n ?? '').includes(term); });
    }
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: false }));
  }

  // ─────────────────────────── Helpers ───────────────────────────
  private async loadActive(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    const step = await this.db().claimStep.findFirst({ where: { claimId, state: 'PENDING' }, orderBy: { order: 'desc' } });
    if (!step) throw new BadRequestException('این پرونده مرحله فعالی ندارد');
    return { claim, step };
  }

  private assertStepActor(step: any, claim: any) {
    const ctx = getContext();
    if (step.partyType === 'POLICYHOLDER') {
      // The بیمه‌گزار (customer realm) — or a participant org (معرف/insurer) acting on their behalf.
      const isOwner = ctx?.actorType === 'CUSTOMER' && claim.policyHolderId === ctx?.actorId;
      const isParticipant = ctx?.actorType === 'ORG_USER' && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId);
      if (!isOwner && !isParticipant) throw new ForbiddenException('اجازه اقدام روی این مرحله را ندارید');
      return;
    }
    if (ctx?.actorType !== 'ORG_USER' || ctx.tenantId !== step.holderTenantId) {
      throw new ForbiddenException('این مرحله در اختیار سازمان شما نیست');
    }
  }

  private assertParticipant(claim: any) {
    const ctx = getContext();
    if (ctx?.actorType === 'SUPER_ADMIN') return;
    if (ctx?.actorType === 'CUSTOMER' && claim.policyHolderId === ctx.actorId) return;
    if (ctx?.actorType === 'ORG_USER' && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId)) return;
    throw new ForbiddenException('دسترسی به این پرونده ندارید');
  }

  private levelAt(insurerTenantId: string, order: number) {
    return this.db().approvalLevel.findFirst({ where: { tenantId: insurerTenantId, order, isActive: true } });
  }

  private addStep(claimId: string, order: number, partyType: any, holderTenantId: string, extra: { levelId?: string; holderBranchId?: string | null; direction?: string } = {}) {
    return this.db().claimStep.create({
      data: { claimId, order, partyType, holderTenantId, levelId: extra.levelId ?? null, holderBranchId: extra.holderBranchId ?? null, direction: extra.direction ?? 'UP', state: 'PENDING' },
    });
  }

  private actor(): string | null {
    return getContext()?.actorId ?? null;
  }

  /** Short, human-readable, sequential claim number, e.g. CLM-00042. Collision-safe. */
  private async newClaimNumber(): Promise<string> {
    const db = this.db();
    let seq = (await db.claim.count()) + 1;
    for (;;) {
      const num = `CLM-${String(seq).padStart(5, '0')}`;
      const exists = await db.claim.findUnique({ where: { claimNumber: num }, select: { id: true } });
      if (!exists) return num;
      seq++;
    }
  }

  private async reload(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true } });
    return this.present(claim, true);
  }

  private present(c: any, full = false) {
    const base = {
      id: c.id,
      claimNumber: c.claimNumber,
      status: c.status,
      claimType: c.claimType,
      channel: c.channel,
      claimedAmount: c.claimedAmount?.toString(), // = estimatedAmount (مبلغ برآوردی); kept for back-compat
      estimatedAmount: c.claimedAmount?.toString(), // مبلغ خسارت برآوردی — set at filing
      finalizedAmount: c.finalizedAmount != null ? c.finalizedAmount.toString() : null, // مبلغ خسارت قطعی — after assessment
      payableAmount: (c.finalizedAmount ?? c.claimedAmount)?.toString(), // what will actually be paid
      policyNumber: c.policyNumber ?? null,
      description: c.description ?? null,
      deceasedName: c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : null,
      insurerTenantId: c.insurerTenantId,
      brokerTenantId: c.brokerTenantId,
      eventDate: c.eventDate ? toJalali(c.eventDate, false) : null,
      noticeDeadline: c.noticeDeadline ? toJalali(c.noticeDeadline, false) : null,
      lateNotice: c.lateNotice,
      createdAt: c.createdAt ? toJalali(c.createdAt) : null,
    };
    if (!full) return base;
    return {
      ...base,
      steps: (c.steps ?? []).map((s: any) => ({ order: s.order, partyType: s.partyType, state: s.state, levelId: s.levelId, holderTenantId: s.holderTenantId, note: s.note, decidedAt: s.decidedAt ? toJalali(s.decidedAt) : null })),
      deficiencies: (c.deficiencies ?? []).map((d: any) => ({ items: safeParse(d.items), resolvedAt: d.resolvedAt ? toJalali(d.resolvedAt) : null })),
    };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
