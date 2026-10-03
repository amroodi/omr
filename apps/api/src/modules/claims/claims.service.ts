import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimStatus, ClaimType, Prisma, SalesChannel } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext } from '../../common/tenant/tenant-context';
import { toJalali } from '../../common/jalali/jalali.util';

const CLAIM_DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

interface FileClaimInput {
  insurerTenantId: string;
  channel: SalesChannel;
  brokerTenantId?: string; // BROKER channel
  sellingBranchId?: string; // DIRECT channel (insurer branch)
  claimType?: ClaimType;
  policyNumber?: string;
  claimedAmount: string;
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
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  // ─────────────────────────── Filing ───────────────────────────
  async file(input: FileClaimInput) {
    const db = this.db();
    const insurer = await db.tenant.findUnique({ where: { id: input.insurerTenantId }, select: { id: true, kind: true } });
    if (!insurer || insurer.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');

    let moarefTenantId: string;
    let moarefBranchId: string | null = null;
    let moarefRole: string;
    if (input.channel === 'BROKER') {
      if (!input.brokerTenantId) throw new BadRequestException('کارگزار (معرف) الزامی است');
      const broker = await db.tenant.findUnique({ where: { id: input.brokerTenantId }, select: { kind: true } });
      if (!broker || broker.kind !== 'BROKER') throw new BadRequestException('کارگزار نامعتبر است');
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
    const claim = await db.claim.create({
      data: {
        claimNumber: this.newClaimNumber(),
        insurerTenantId: input.insurerTenantId,
        channel: input.channel,
        brokerTenantId: input.channel === 'BROKER' ? input.brokerTenantId : null,
        sellingBranchId: moarefBranchId,
        policyHolderId: input.policyHolderId ?? getContext()?.actorId ?? null,
        deceasedFullName: this.crypto.encrypt(input.deceasedFullName)!,
        deceasedNationalCode: this.crypto.encrypt(nid)!,
        deceasedNationalCodeHash: this.crypto.blindIndex(nid)!,
        claimType: input.claimType ?? 'DEATH_ILLNESS',
        policyNumber: input.policyNumber ?? null,
        claimedAmount: input.claimedAmount,
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
      return this.reload(claim.id);
    }
    // Beyond this level's authority → escalate strictly to the next level (no skipping).
    const next = await this.levelAt(claim.insurerTenantId, level.order + 1);
    if (!next) throw new BadRequestException('سطح بالاتری برای ارجاع تعریف نشده است');
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'ESCALATED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await this.addStep(claim.id, step.order + 1, 'INSURER_LEVEL', claim.insurerTenantId, { levelId: next.id });
    await this.audit.record({ action: AuditAction.CLAIM_ESCALATE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { from: level.order, to: next.order } });
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
    return this.reload(claim.id);
  }

  private async reject(claim: any, step: any, note?: string) {
    const db = this.db();
    await db.claimStep.update({ where: { id: step.id }, data: { state: 'REJECTED', note: note ?? null, decidedById: this.actor(), decidedAt: new Date() } });
    await db.claim.update({ where: { id: claim.id }, data: { status: ClaimStatus.REJECTED } });
    await this.audit.record({ action: AuditAction.CLAIM_REJECT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claim.id });
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
      select: { id: true, docCode: true, fileName: true, verificationStatus: true },
    });
    const byCode = new Map<string, any[]>();
    for (const d of docs) {
      const k = d.docCode ?? '_other';
      if (!byCode.has(k)) byCode.set(k, []);
      byCode.get(k)!.push(d);
    }
    const items = reqs.map((r) => ({
      code: r.code,
      label: r.label,
      appliesToTypes: r.appliesToTypes,
      uploaded: (byCode.get(r.code) ?? []).length > 0,
      documents: byCode.get(r.code) ?? [],
    }));
    const reqCodes = new Set(reqs.map((r) => r.code));
    return {
      claimType: claim.claimType,
      complete: items.length > 0 && items.every((i) => i.uploaded),
      items,
      otherDocuments: docs.filter((d) => !d.docCode || !reqCodes.has(d.docCode)),
    };
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
    return doc;
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

  private newClaimNumber(): string {
    return `CLM-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
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
      deceasedName: c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : null,
      insurerTenantId: c.insurerTenantId,
      brokerTenantId: c.brokerTenantId,
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
