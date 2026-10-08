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

  /** Insurer records the payout after final approval (ties to the maker-checker payment). */
  async markPaid(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    if (claim.status !== ClaimStatus.APPROVED) throw new BadRequestException('پرونده تایید نشده است');
    await this.db().claim.update({ where: { id: claimId }, data: { status: ClaimStatus.PAID } });
    await this.audit.record({ action: AuditAction.CLAIM_PAY, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId });
    await this.notifyPolicyHolder(claim.policyHolderId, 'پرداخت خسارت', `خسارت پرونده ${claim.claimNumber} پرداخت شد.`);
    return this.reload(claimId);
  }

  // ─────────────────────────── Reads ───────────────────────────
  async get(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    return this.present(claim, true);
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
        ? { policyHolderId: ctx.actorId }
        : { OR: [{ insurerTenantId: ctx?.tenantId }, { brokerTenantId: ctx?.tenantId }, { participants: { some: { tenantId: ctx?.tenantId } } }] };
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
      const claims = await db.claim.findMany({ where: { policyHolderId: ctx.actorId, steps: { some: { state: 'PENDING', partyType: 'POLICYHOLDER' } } }, include: { steps: true } });
      return claims.map((c) => this.present(c));
    }
    const claims = await db.claim.findMany({
      where: { steps: { some: { state: 'PENDING', holderTenantId: ctx?.tenantId } } },
      include: { steps: true },
    });
    return claims.map((c) => this.present(c));
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
      claimedAmount: c.claimedAmount?.toString(),
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
