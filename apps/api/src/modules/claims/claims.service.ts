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
import { PolicyholdersService } from '../policyholders/policyholders.service';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { above, actionsFor, ActionKey, below, chainOf, DeskDocFacts, Direction, higher, physicalActionsFor, PhysicalActionKey, physicalBelow, PhysicalState, Purpose, ReviewDesk, Stage, STAGE_FA, WorkflowAction } from './workflow';

const CLAIM_DOC_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

// How long a soft-deleted claim stays restorable before the daily purge removes it for good.
export const CLAIM_RETENTION_DAYS = 14;

type ReviewStateName = 'PENDING' | 'APPROVED' | 'REJECTED';

const DOC_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار بررسی',
  VERIFIED: 'تاییدشده',
  REJECTED: 'ردشده',
  NEEDS_INFO: 'نیاز به اصلاح/ارسال مجدد',
};

interface FileClaimInput {
  insurerTenantId?: string; // omitted when the بیمه‌گزار files: resolved from its company's insurer contract
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
  deceasedBirthDate?: string; // ISO
  policyHolderId?: string;
  policyholderCompanyId?: string; // بیمه‌گزار company (set automatically when the بیمه‌گزار files)
}

/** The caller's seat in the claim chain (see myDesk). */
interface Desk {
  stage: Stage | null;
  tenantId: string | null;
  branchId: string | null;
  isAdmin: boolean; // claim:override — may skip desks on the way down (management discretion)
}

export interface ActInput {
  action: ActionKey;
  note?: string;
  letterId?: string; // a ClaimLetter created beforehand via POST /claims/:id/letters
  deficiencies?: string[]; // RETURN: free-text deficiency lines (rejected documents are added automatically)
  branchId?: string; // FORWARD from کارگزاری: the insurer branch that will handle the claim
}

export interface PhysicalInput {
  action: PhysicalActionKey;
  note?: string;
  trackingNo?: string; // courier / post tracking number when sending
  letterId?: string;
}

/**
 * Death-claim routing engine. See docs/CLAIMS-WORKFLOW.md and ./workflow.ts for the chain rules.
 *
 * Claims are cross-tenant, so this uses the UN-scoped client with explicit access checks:
 * an operator may act only while the claim sits at their desk (holdsDesk); the بیمه‌گزار
 * (customer realm) only while it sits with them.
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
    private readonly policyholders: PolicyholdersService,
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

  /** Oversight note for the acting operator's own-org admins (in-panel only; actor excluded). */
  private async notifyAdminsActivity(title: string, body: string, link = '/org/claims') {
    const ctx = getContext();
    await this.notifications.notifyOrgAdmins(ctx?.tenantId, title, body, link, { excludeActorId: ctx?.actorId ?? null });
  }

  /** Human label for the current actor, for activity messages (e.g. «کارشناس احمدی»). */
  private async actorLabel(): Promise<string> {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER') return 'بیمه‌گزار';
    if (ctx?.actorType === 'SUPER_ADMIN') return 'مدیر سامانه';
    if (ctx?.actorId) {
      const u = await this.db().orgUser.findUnique({ where: { id: ctx.actorId }, select: { displayName: true, username: true } });
      return u?.displayName || u?.username || 'کاربر سازمان';
    }
    return 'سیستم';
  }

  private db() {
    return this.prisma.unscoped();
  }

  // ─────────────────────────── Filing ───────────────────────────
  async file(input: FileClaimInput) {
    const db = this.db();
    const ctx = getContext();
    const eventDate = input.eventDate ? new Date(input.eventDate) : null;

    // A بیمه‌گزار doesn't choose the insurer: the brokerage's contract for their company that covered
    // the date of death decides it (and supplies the policy number).
    let companyId = input.policyholderCompanyId ?? null;
    if (ctx?.actorType === 'CUSTOMER') {
      const acc = await db.customerAccount.findUnique({ where: { id: ctx.actorId }, select: { companyId: true } });
      if (!acc?.companyId) throw new BadRequestException('حساب شما هنوز به شرکت بیمه‌گزار متصل نشده است؛ لطفاً با کارگزاری تماس بگیرید.');
      companyId = acc.companyId;
      input.insurerTenantId = undefined;
    }
    if (companyId && !input.insurerTenantId) {
      const contract = await this.policyholders.resolveContract(companyId, eventDate);
      if (!contract) throw new BadRequestException('برای این تاریخ فوت، قرارداد فعالی میان کارگزاری و بیمه‌گر برای شرکت شما ثبت نشده است؛ لطفاً با کارگزاری تماس بگیرید.');
      input.insurerTenantId = contract.insurerTenantId;
      input.policyNumber = input.policyNumber ?? contract.policyNumber ?? undefined;
    }
    if (!input.insurerTenantId) throw new BadRequestException('بیمه‌گر نامعتبر است');
    const insurer = await db.tenant.findUnique({ where: { id: input.insurerTenantId }, select: { id: true, kind: true, noticeDays: true } });
    if (!insurer || insurer.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');
    const insurerTenantId = insurer.id;

    // 30-day (configurable) notice deadline: event date + insurer.noticeDays.
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
      const partner = await db.brokerInsurerPartnership.findFirst({ where: { brokerTenantId: input.brokerTenantId, insurerTenantId, isActive: true }, select: { id: true } });
      if (!partner) throw new BadRequestException('این کارگزاری با این بیمه‌گر همکاری فعال ندارد');
      moarefTenantId = input.brokerTenantId;
      moarefRole = 'MOAREF_BROKER';
    } else {
      if (!input.sellingBranchId) throw new BadRequestException('شعبه فروشنده (معرف) الزامی است');
      const branch = await db.branch.findFirst({ where: { id: input.sellingBranchId, tenantId: insurerTenantId }, select: { id: true } });
      if (!branch) throw new BadRequestException('شعبه فروشنده متعلق به بیمه‌گر نیست');
      moarefTenantId = insurerTenantId;
      moarefBranchId = input.sellingBranchId;
      moarefRole = 'MOAREF_BRANCH';
    }

    // The بیمه‌گزار keeps a claim they filed until they press «ارسال به …» (documents are uploaded
    // first); an operator filing on their behalf puts it straight onto the first reviewer's desk.
    const byPolicyHolder = getContext()?.actorType === 'CUSTOMER';
    const firstStage: Stage = byPolicyHolder ? 'POLICYHOLDER' : input.channel === 'BROKER' ? 'BROKER' : 'BRANCH';

    const nid = input.deceasedNationalCode;
    const claimNumber = await this.newClaimNumber();
    const claim = await db.claim.create({
      data: {
        claimNumber,
        insurerTenantId: insurerTenantId,
        channel: input.channel,
        brokerTenantId: input.channel === 'BROKER' ? input.brokerTenantId : null,
        sellingBranchId: moarefBranchId,
        policyHolderId: input.policyHolderId ?? getContext()?.actorId ?? null,
        policyholderCompanyId: companyId,
        deceasedBirthDate: input.deceasedBirthDate ? new Date(input.deceasedBirthDate) : null,
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
        status: byPolicyHolder ? ClaimStatus.SUBMITTED : ClaimStatus.UNDER_REVIEW,
        currentStage: firstStage,
        flowDirection: 'UP',
        flowPurpose: 'REVIEW',
        handlingBranchId: moarefBranchId,
        participants: {
          create: [
            { tenantId: insurerTenantId, role: 'INSURER' },
            ...(input.channel === 'BROKER' ? [{ tenantId: input.brokerTenantId!, role: 'MOAREF_BROKER' }] : []),
          ],
        },
        steps: {
          create: [{
            order: 1,
            partyType: firstStage === 'POLICYHOLDER' ? 'POLICYHOLDER' : 'MOAREF',
            stage: firstStage,
            purpose: 'REVIEW',
            holderTenantId: firstStage === 'POLICYHOLDER' ? insurerTenantId : moarefTenantId,
            holderBranchId: firstStage === 'BRANCH' ? moarefBranchId : null,
            state: 'PENDING',
            direction: 'UP',
          }],
        },
      },
      include: { steps: true },
    });

    await this.audit.record({ action: AuditAction.CLAIM_SUBMIT, tenantId: insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { channel: input.channel, moaref: moarefRole } });
    if (byPolicyHolder) {
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد؛ مدارک را بارگذاری و پرونده را ارسال کنید.`);
    } else {
      await this.notifyOrg(moarefTenantId, 'پرونده خسارت جدید', `پرونده ${claim.claimNumber} برای بررسی در انتظار شماست.`);
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد و در حال بررسی است.`);
    }
    return this.present(claim);
  }

  // ─────────────────────────── Workflow (v2 engine) ───────────────────────────
  /** Which desk of the chain the caller sits at, and whether they hold management discretion. */
  private async myDesk(): Promise<Desk> {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER') return { stage: 'POLICYHOLDER', tenantId: ctx.tenantId ?? null, branchId: null, isAdmin: false };
    if (ctx?.actorType !== 'ORG_USER' || !ctx.tenantId) return { stage: null, tenantId: null, branchId: null, isAdmin: false };
    const db = this.db();
    const [tenant, user] = await Promise.all([
      db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { kind: true } }),
      ctx.actorId ? db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { desk: true, branchId: true } }) : null,
    ]);
    const branchId = user?.branchId ?? ctx.branchId ?? null;
    let stage: Stage;
    if (tenant?.kind === 'BROKER') stage = 'BROKER';
    else if (user?.desk === 'HQ' || user?.desk === 'COUNCIL' || user?.desk === 'BRANCH') stage = user.desk;
    else stage = branchId ? 'BRANCH' : 'HQ';
    return { stage, tenantId: ctx.tenantId, branchId, isAdmin: (ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_OVERRIDE) };
  }

  /** Does the caller hold the claim's current desk (right desk, right org, right branch)? */
  private holdsDesk(claim: any, desk: Desk): boolean {
    return this.sitsAt(claim, claim.currentStage as Stage | null, desk);
  }

  /** Does the caller sit at desk `s` of this claim (right desk, right org, right branch)? */
  private sitsAt(claim: any, s: Stage | null, desk: Desk): boolean {
    if (!s || claim.imported) return false;
    const ctx = getContext();
    if (s === 'POLICYHOLDER') {
      // The بیمه‌گزار — or a participant org acting on their behalf (filing staff with claim:file).
      if (ctx?.actorType === 'CUSTOMER') return claim.policyHolderId === ctx.actorId;
      return ctx?.actorType === 'ORG_USER' && (ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_FILE) && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId);
    }
    if (desk.stage !== s) return false;
    if (s === 'BROKER') return desk.tenantId === claim.brokerTenantId;
    if (desk.tenantId !== claim.insurerTenantId) return false;
    if (s === 'BRANCH') return !claim.handlingBranchId || desk.branchId === claim.handlingBranchId;
    return true;
  }

  /** Latest version of each document on the claim (one per required-doc code; each "other" upload on its own). */
  private async latestDocs(claimId: string) {
    const docs = await this.db().document.findMany({ where: { claimId }, orderBy: { createdAt: 'desc' }, select: { id: true, docCode: true, fileName: true, reviews: { select: { stage: true, state: true } } } });
    const seen = new Set<string>();
    return docs.filter((d) => {
      if (!d.docCode) return true;
      if (seen.has(d.docCode)) return false;
      seen.add(d.docCode);
      return true;
    });
  }

  private async deskDocFacts(claim: any): Promise<DeskDocFacts> {
    const [latest, reqs] = await Promise.all([
      this.latestDocs(claim.id),
      this.db().requiredDocument.findMany({ where: { tenantId: claim.insurerTenantId }, select: { code: true, label: true } }),
    ]);
    const labels = new Map(reqs.map((r) => [r.code, r.label]));
    const label = (d: { docCode: string | null; fileName: string }) => (d.docCode && labels.get(d.docCode)) || d.fileName;
    const s = claim.currentStage as Stage | null;
    const reviewing = !!s && s !== 'POLICYHOLDER';
    const stateAt = (d: (typeof latest)[number]) => d.reviews.find((r) => r.stage === s)?.state ?? 'PENDING';
    return {
      count: latest.length,
      allApproved: reviewing && latest.length > 0 && latest.every((d) => stateAt(d) === 'APPROVED'),
      rejectedLabels: reviewing ? latest.filter((d) => stateAt(d) === 'REJECTED').map(label) : [],
      rejectedAnywhere: latest.filter((d) => d.reviews.some((r) => r.state === 'REJECTED')).map(label),
    };
  }

  /** Actions the caller may take on the claim right now (empty unless they hold its desk). */
  private async availableActions(claim: any, desk: Desk): Promise<WorkflowAction[]> {
    if (!this.holdsDesk(claim, desk)) return [];
    const db = this.db();
    const [docs, insurer, branches, physical] = await Promise.all([
      this.deskDocFacts(claim),
      db.tenant.findUnique({ where: { id: claim.insurerTenantId }, select: { hqCeiling: true } }),
      claim.currentStage === 'BROKER'
        ? db.branch.findMany({ where: { tenantId: claim.insurerTenantId }, orderBy: { code: 'asc' }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
      this.physicalState(claim),
    ]);
    return actionsFor({ claim, isAdmin: desk.isAdmin, hqCeiling: insurer?.hqCeiling ?? null, docs, branches, physical });
  }

  /** The claim's place in the chain + what the caller can do, for the panels. */
  private async workflowView(claim: any) {
    const desk = await this.myDesk();
    const s = claim.currentStage as Stage | null;
    const holds = this.holdsDesk(claim, desk);
    return {
      chain: chainOf(claim).map((st) => ({ stage: st, label: STAGE_FA[st] })),
      currentStage: s,
      currentStageLabel: s ? STAGE_FA[s] : null,
      direction: claim.flowDirection ?? null,
      purpose: claim.flowPurpose ?? null,
      returnTargetStage: claim.returnTargetStage ?? null,
      returnTargetLabel: claim.returnTargetStage ? STAGE_FA[claim.returnTargetStage as Stage] : null,
      myStage: desk.stage,
      holdsDesk: holds,
      lossNotice: claim.lossNoticeNumber ? { number: claim.lossNoticeNumber, date: claim.lossNoticeDate ? toJalali(claim.lossNoticeDate, false) : null } : null,
      canRecordLossNotice: s === 'BRANCH' && claim.flowDirection === 'UP' && holds,
      actions: await this.availableActions(claim, desk),
      physical: await this.physicalView(claim, desk),
    };
  }

  /**
   * Take one workflow action. The action must be among those `availableActions` offers the caller
   * (so every rule lives in one place); a disabled action fails with its reason.
   */
  async act(claimId: string, input: ActInput) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const desk = await this.myDesk();
    const actions = await this.availableActions(claim, desk);
    const a = actions.find((x) => x.key === input.action);
    if (!a) throw new ForbiddenException(this.holdsDesk(claim, desk) ? 'این اقدام در این مرحله مجاز نیست' : 'پرونده در اختیار شما نیست');
    if (a.disabled) throw new BadRequestException(a.disabled);
    if (a.needsNote && !input.note?.trim()) throw new BadRequestException('توضیح الزامی است');

    const step = await db.claimStep.findFirst({ where: { claimId, state: 'PENDING' }, orderBy: { order: 'desc' } });
    if (!step) throw new BadRequestException('این پرونده مرحله فعالی ندارد');
    await this.assertLetterFree(claimId, input.letterId);

    const s = claim.currentStage as Stage;
    const dn = below(claim, s);
    const up = above(claim, s);
    const note = input.note?.trim() || null;
    const base = { action: a.key, note, letterId: input.letterId };

    switch (a.key) {
      case 'SUBMIT': {
        const resubmit = (await db.claimDeficiency.count({ where: { claimId, resolvedAt: null } })) > 0;
        await db.claimDeficiency.updateMany({ where: { claimId, resolvedAt: null }, data: { resolvedAt: new Date() } });
        await this.move(claim, step, { ...base, closeState: 'FORWARDED', to: up!, direction: 'UP', purpose: 'REVIEW', status: ClaimStatus.UNDER_REVIEW });
        await this.audit.record({ action: resubmit ? AuditAction.CLAIM_RECTIFY : AuditAction.CLAIM_SUBMIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId });
        await this.notifyHolder(claim, up!, resubmit ? 'رفع نقص انجام شد' : 'پرونده خسارت جدید', resubmit
          ? `نقص مدارک پروندهٔ ${claim.claimNumber} رفع شد؛ مدارک اصلاح‌شده در انتظار بررسی شماست.`
          : `پروندهٔ ${claim.claimNumber} برای بررسی در انتظار شماست.`);
        break;
      }
      case 'FORWARD': {
        const extra: Prisma.ClaimUpdateInput = {};
        let branchId = claim.handlingBranchId;
        if (s === 'BROKER') {
          branchId = input.branchId || claim.handlingBranchId;
          if (!branchId) throw new BadRequestException('شعبهٔ رسیدگی‌کننده را انتخاب کنید');
          if (!a.branchOptions?.some((b) => b.id === branchId)) throw new BadRequestException('شعبه متعلق به بیمه‌گر نیست');
          extra.handlingBranchId = branchId;
        }
        if (claim.returnTargetStage === s) extra.returnTargetStage = null;
        await this.move(claim, step, { ...base, closeState: 'FORWARDED', to: up!, direction: 'UP', purpose: 'REVIEW', status: ClaimStatus.UNDER_REVIEW, extra, branchId });
        await this.audit.record({ action: AuditAction.CLAIM_FORWARD, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { from: s, to: up } });
        await this.notifyHolder(claim, up!, 'پرونده برای بررسی ارسال شد', `پروندهٔ ${claim.claimNumber} از ${STAGE_FA[s]} برای بررسی به شما ارسال شد.`);
        break;
      }
      case 'REFER_COUNCIL': {
        const extra: Prisma.ClaimUpdateInput = claim.returnTargetStage === 'HQ' ? { returnTargetStage: null } : {};
        await this.move(claim, step, { ...base, closeState: 'ESCALATED', to: 'COUNCIL', direction: 'UP', purpose: 'REVIEW', status: ClaimStatus.UNDER_REVIEW, extra });
        await this.audit.record({ action: AuditAction.CLAIM_ESCALATE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { from: s, to: 'COUNCIL' } });
        await this.notifyHolder(claim, 'COUNCIL', 'ارجاع به شورای فنی', `پروندهٔ ${claim.claimNumber} از مدیریت ستاد به شورای فنی ارجاع شد.`);
        break;
      }
      case 'PAY_ORDER': {
        await this.move(claim, step, { ...base, closeState: 'APPROVED', to: dn!, direction: 'DOWN', purpose: 'PAYMENT', status: ClaimStatus.APPROVED, extra: { returnTargetStage: null } });
        await this.audit.record({ action: AuditAction.CLAIM_APPROVE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { by: s } });
        await this.notifyHolder(claim, dn!, 'دستور پرداخت', `برای پروندهٔ ${claim.claimNumber} از سوی ${STAGE_FA[s]} دستور پرداخت صادر شد.`);
        await this.notifyPolicyHolder(claim.policyHolderId, 'تایید پرونده خسارت', `پروندهٔ ${claim.claimNumber} تایید شد و دستور پرداخت صادر شده است.`);
        break;
      }
      case 'RETURN':
      case 'RETURN_DIRECT': {
        const docs = await this.deskDocFacts(claim);
        const items = [...docs.rejectedLabels.map((l) => `مدرک ردشده: ${l}`), ...(input.deficiencies ?? []).map((x) => x.trim()).filter(Boolean)];
        if (!items.length) throw new BadRequestException('حداقل یک مدرک را رد کنید یا یک مورد نقص بنویسید');
        const to: Stage = a.key === 'RETURN_DIRECT' ? 'POLICYHOLDER' : dn!;
        await db.claimDeficiency.create({ data: { claimId, raisedByTenantId: getContext()?.tenantId ?? null, raisedByStepId: step.id, items: JSON.stringify(items) } });
        await this.move(claim, step, { ...base, closeState: 'RETURNED_INCOMPLETE', to, direction: 'DOWN', purpose: 'DEFICIENCY', status: ClaimStatus.RETURNED_INCOMPLETE, extra: { returnTargetStage: higher(claim.returnTargetStage as Stage | null, s) } });
        await this.audit.record({ action: AuditAction.CLAIM_RETURN_INCOMPLETE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { by: s, to, items } });
        await this.notifyHolder(claim, to, 'عودت پرونده برای رفع نقص', `پروندهٔ ${claim.claimNumber} از سوی ${STAGE_FA[s]} برای رفع نقص عودت شد: ${items.join('، ')}`);
        break;
      }
      case 'DOWN_FORWARD':
      case 'DOWN_DIRECT': {
        const to: Stage = a.key === 'DOWN_DIRECT' ? 'POLICYHOLDER' : dn!;
        const purpose = claim.flowPurpose as Purpose;
        await this.move(claim, step, { ...base, closeState: 'FORWARDED', to, direction: 'DOWN', purpose, status: claim.status });
        await this.audit.record({ action: AuditAction.CLAIM_FORWARD, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { from: s, to, purpose } });
        await this.notifyHolder(claim, to, purpose === 'PAYMENT' ? 'دستور پرداخت' : 'عودت پرونده برای رفع نقص', purpose === 'PAYMENT'
          ? `دستور پرداخت پروندهٔ ${claim.claimNumber} برای اقدام به شما ارسال شد.`
          : `پروندهٔ ${claim.claimNumber} برای رفع نقص از ${STAGE_FA[s]} به شما ارسال شد.`);
        break;
      }
      case 'MARK_PAID': {
        await this.move(claim, step, { ...base, closeState: 'ACKED', to: null, status: ClaimStatus.PAID });
        await this.audit.record({ action: AuditAction.CLAIM_PAY, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId });
        await this.notifyPolicyHolder(claim.policyHolderId, 'پرداخت خسارت', `خسارت پروندهٔ ${claim.claimNumber} پرداخت شد.`);
        if (claim.brokerTenantId) await this.notifyOrg(claim.brokerTenantId, 'پرداخت خسارت', `خسارت پروندهٔ ${claim.claimNumber} توسط شعبه پرداخت شد.`, `/org/claims/${claimId}`);
        break;
      }
      case 'REQUEST_PHYSICAL': {
        // Side track: the claim stays at this desk; the request goes one desk down.
        const holder = physicalBelow(s)!;
        const req = await db.claimPhysicalRequest.create({ data: { claimId, requesterStage: s, holderStage: holder, createdById: this.actor() } });
        const ev = await db.claimPhysicalEvent.create({ data: { requestId: req.id, claimId, stage: s, action: 'REQUEST', note, actorId: this.actor() } });
        if (input.letterId) await db.claimLetter.update({ where: { id: input.letterId }, data: { physicalEventId: ev.id } });
        await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimPhysicalRequest', targetId: req.id, metadata: { claimId, requester: s, holder } });
        await this.notifyHolder(claim, holder, 'درخواست اصل مدارک', `${STAGE_FA[s]} اصل مدارک پروندهٔ ${claim.claimNumber} را درخواست کرده است.`);
        break;
      }
      case 'REJECT_FINAL': {
        await this.move(claim, step, { ...base, closeState: 'REJECTED', to: null, status: ClaimStatus.REJECTED });
        await this.audit.record({ action: AuditAction.CLAIM_REJECT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { by: s } });
        await this.notifyPolicyHolder(claim.policyHolderId, 'رد پرونده خسارت', `پروندهٔ ${claim.claimNumber} رد شد${note ? `: ${note}` : '.'}`);
        if (claim.brokerTenantId) await this.notifyOrg(claim.brokerTenantId, 'رد پرونده خسارت', `پروندهٔ ${claim.claimNumber} توسط ${STAGE_FA[s]} رد شد.`, `/org/claims/${claimId}`);
        break;
      }
    }
    await this.notifyAdminsActivity('اقدام در گردش کار', `${await this.actorLabel()} روی پروندهٔ ${claim.claimNumber}: «${a.label}».`, `/org/claims/${claimId}`);
    return this.get(claimId);
  }

  /** Close the pending step and open the next desk's step (or close the claim when `to` is null). */
  private async move(
    claim: any,
    step: any,
    m: { action: ActionKey; closeState: string; note: string | null; letterId?: string; to: Stage | null; direction?: Direction; purpose?: Purpose; status: ClaimStatus; extra?: Prisma.ClaimUpdateInput; branchId?: string | null },
  ) {
    const db = this.db();
    await db.claimStep.update({ where: { id: step.id }, data: { state: m.closeState as any, action: m.action, note: m.note, decidedById: this.actor(), decidedAt: new Date() } });
    if (m.letterId) await db.claimLetter.update({ where: { id: m.letterId }, data: { stepId: step.id } });
    if (m.to) {
      const holderTenantId = m.to === 'BROKER' ? claim.brokerTenantId : claim.insurerTenantId;
      const partyType = m.to === 'POLICYHOLDER' ? 'POLICYHOLDER' : m.to === 'BROKER' ? 'MOAREF' : 'INSURER_LEVEL';
      await db.claimStep.create({
        data: {
          claimId: claim.id, order: step.order + 1, partyType, holderTenantId, stage: m.to, purpose: m.purpose, direction: m.direction ?? 'UP', state: 'PENDING',
          holderBranchId: m.to === 'BRANCH' ? (m.branchId ?? claim.handlingBranchId ?? null) : null,
        },
      });
    }
    await db.claim.update({
      where: { id: claim.id },
      data: { ...(m.extra ?? {}), status: m.status, currentStage: m.to, flowDirection: m.to ? m.direction : null, flowPurpose: m.to ? m.purpose : null },
    });
  }

  /** Tell whoever now holds the claim: the بیمه‌گزار, or the holding org's inbox. */
  private async notifyHolder(claim: any, to: Stage, title: string, body: string) {
    if (to === 'POLICYHOLDER') return this.notifyPolicyHolder(claim.policyHolderId, title, body);
    const tenantId = to === 'BROKER' ? claim.brokerTenantId : claim.insurerTenantId;
    if (tenantId) await this.notifyOrg(tenantId, title, `${body} (مرحله: ${STAGE_FA[to]})`, `/org/claims/${claim.id}`);
  }

  /** بیمه‌گزار sends the claim on — initial submission or after رفع نقص. */
  async rectify(claimId: string, note?: string) {
    return this.act(claimId, { action: 'SUBMIT', note });
  }

  /** شعبه records اعلام خسارت (the loss registered in the insurer's own system) before forwarding. */
  async setLossNotice(claimId: string, number: string, date?: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const desk = await this.myDesk();
    if (claim.currentStage !== 'BRANCH' || claim.flowDirection !== 'UP' || !this.holdsDesk(claim, desk)) {
      throw new ForbiddenException('ثبت اعلام خسارت فقط توسط شعبهٔ رسیدگی‌کننده ممکن است');
    }
    const n = String(number ?? '').trim();
    if (!n) throw new BadRequestException('شمارهٔ اعلام خسارت الزامی است');
    await db.claim.update({ where: { id: claimId }, data: { lossNoticeNumber: n, lossNoticeDate: date ? new Date(date) : new Date(), lossNoticeById: this.actor() } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { lossNoticeNumber: n } });
    return this.get(claimId);
  }

  // ─────────────────────────── Original (physical) documents ───────────────────────────
  private async openPhysicalRequest(claimId: string) {
    return this.db().claimPhysicalRequest.findFirst({ where: { claimId, status: { in: ['REQUESTED', 'SENT'] } }, orderBy: { createdAt: 'desc' } });
  }

  private async physicalState(claim: any): Promise<PhysicalState> {
    const o = await this.openPhysicalRequest(claim.id);
    return { at: (claim.physicalAt as Stage | null) ?? null, open: o ? { requesterStage: o.requesterStage as Stage, holderStage: o.holderStage as Stage, status: o.status as 'REQUESTED' | 'SENT' } : null };
  }

  /** The desks the caller sits at on this claim, for physical-document actions (an org user acting for بیمه‌گزار counts too). */
  private physicalSeats(claim: any, desk: Desk): Stage[] {
    const seats: Stage[] = [];
    if (desk.stage && desk.stage !== 'POLICYHOLDER' && this.sitsAt(claim, desk.stage, desk)) seats.push(desk.stage);
    if (this.sitsAt(claim, 'POLICYHOLDER', desk)) seats.push('POLICYHOLDER');
    return seats;
  }

  private async physicalView(claim: any, desk: Desk) {
    const db = this.db();
    const state = await this.physicalState(claim);
    const seats = this.physicalSeats(claim, desk);
    const actions = seats.flatMap((st) => physicalActionsFor(st, state).map((a) => ({ ...a, seat: st })));
    const [events, letters] = await Promise.all([
      db.claimPhysicalEvent.findMany({ where: { claimId: claim.id }, orderBy: { createdAt: 'asc' } }),
      db.claimLetter.findMany({ where: { claimId: claim.id, physicalEventId: { not: null } } }),
    ]);
    const isOrg = getContext()?.actorType === 'ORG_USER';
    const actorIds = isOrg ? [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[] : [];
    const users = actorIds.length ? await db.orgUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } }) : [];
    const uMap = new Map(users.map((u) => [u.id, u.displayName]));
    const o = state.open;
    return {
      at: state.at ?? 'POLICYHOLDER',
      atLabel: STAGE_FA[state.at ?? 'POLICYHOLDER'],
      collected: !!state.at,
      open: o ? { ...o, requesterLabel: STAGE_FA[o.requesterStage], holderLabel: STAGE_FA[o.holderStage] } : null,
      actions,
      events: events.map((e) => ({
        id: e.id, stage: e.stage, stageLabel: STAGE_FA[e.stage as Stage], action: e.action, note: e.note, trackingNo: e.trackingNo,
        at: toJalali(e.createdAt), by: e.actorId ? (uMap.get(e.actorId) ?? null) : null,
        letters: letters.filter((l) => l.physicalEventId === e.id).map((l) => ({ id: l.id, number: l.number, subject: l.subject, date: l.letterDate ? toJalali(l.letterDate, false) : null, hasFile: !!l.storageKey, fileName: l.fileName })),
      })),
    };
  }

  private async assertLetterFree(claimId: string, letterId?: string) {
    if (!letterId) return;
    const letter = await this.db().claimLetter.findFirst({ where: { id: letterId, claimId, stepId: null, physicalEventId: null } });
    if (!letter) throw new BadRequestException('نامهٔ پیوست نامعتبر است');
  }

  /** Relay / send / receive / return the original documents. Offered per desk by physicalActionsFor. */
  async physicalAct(claimId: string, input: PhysicalInput) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const desk = await this.myDesk();
    const state = await this.physicalState(claim);
    const seat = this.physicalSeats(claim, desk).find((st) => physicalActionsFor(st, state).some((a) => a.key === input.action));
    if (!seat) throw new ForbiddenException('این اقدام برای شما در دسترس نیست');
    await this.assertLetterFree(claimId, input.letterId);
    const note = input.note?.trim() || null;
    const trackingNo = input.trackingNo?.trim() || null;
    const open = await this.openPhysicalRequest(claimId);
    const event = async (requestId: string, action: string) => {
      const ev = await db.claimPhysicalEvent.create({ data: { requestId, claimId, stage: seat, action, note, trackingNo, actorId: this.actor() } });
      if (input.letterId) await db.claimLetter.update({ where: { id: input.letterId }, data: { physicalEventId: ev.id } });
    };

    switch (input.action) {
      case 'PHYSICAL_RELAY': {
        const next = physicalBelow(seat)!;
        await db.claimPhysicalRequest.update({ where: { id: open!.id }, data: { holderStage: next } });
        await event(open!.id, 'RELAY');
        await this.notifyHolder(claim, next, 'درخواست اصل مدارک', `${STAGE_FA[open!.requesterStage as Stage]} اصل مدارک پروندهٔ ${claim.claimNumber} را درخواست کرده است (ارسال از طریق ${STAGE_FA[seat]}).`);
        break;
      }
      case 'PHYSICAL_SEND': {
        await db.claimPhysicalRequest.update({ where: { id: open!.id }, data: { status: 'SENT', sentAt: new Date() } });
        await event(open!.id, 'SEND');
        await this.notifyHolder(claim, open!.requesterStage as Stage, 'ارسال اصل مدارک', `اصل مدارک پروندهٔ ${claim.claimNumber} توسط ${STAGE_FA[seat]} ارسال شد${trackingNo ? ` (کد رهگیری ${trackingNo})` : ''}.`);
        break;
      }
      case 'PHYSICAL_RECEIVE': {
        await db.claimPhysicalRequest.update({ where: { id: open!.id }, data: { status: 'RECEIVED', receivedAt: new Date() } });
        await event(open!.id, 'RECEIVE');
        await db.claim.update({ where: { id: claimId }, data: { physicalAt: seat } });
        break;
      }
      case 'PHYSICAL_RETURN': {
        // ستاد / شورا sends the originals back to شعبه, where they are kept.
        const req = await db.claimPhysicalRequest.create({ data: { claimId, requesterStage: 'BRANCH', holderStage: seat, status: 'SENT', sentAt: new Date(), createdById: this.actor() } });
        await event(req.id, 'RETURN');
        await this.notifyHolder(claim, 'BRANCH', 'بازگشت اصل مدارک', `اصل مدارک پروندهٔ ${claim.claimNumber} از ${STAGE_FA[seat]} به شعبه بازگردانده شد.`);
        break;
      }
    }
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimPhysical', targetId: claimId, metadata: { action: input.action, seat, trackingNo } });
    await this.notifyAdminsActivity('اصل مدارک', `${await this.actorLabel()} روی پروندهٔ ${claim.claimNumber}: «${physicalActionsFor(seat, state).find((a) => a.key === input.action)?.label}».`, `/org/claims/${claimId}`);
    return this.get(claimId);
  }

  // ── Letters (مکاتبات) that accompany a hand-off ──
  async createLetter(claimId: string, input: { number?: string; date?: string; subject?: string }, file?: Express.Multer.File) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    if (!input.number?.trim() && !file?.buffer?.length) throw new BadRequestException('شمارهٔ نامه یا فایل نامه الزامی است');
    let stored: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (file?.buffer?.length) {
      if (!CLAIM_DOC_MIME.has(file.mimetype)) throw new BadRequestException('فقط PDF، JPG و PNG مجاز است');
      stored = { storageKey: await this.storage.save(claim.insurerTenantId, file.buffer), fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size };
    }
    const ctx = getContext();
    const letter = await db.claimLetter.create({
      data: {
        claimId, number: input.number?.trim() || null, letterDate: input.date ? new Date(input.date) : null, subject: input.subject?.trim() || null,
        ...(stored ?? {}), createdById: ctx?.actorId ?? null, createdByTenantId: ctx?.tenantId ?? null,
      },
      select: { id: true },
    });
    await this.audit.record({ action: AuditAction.UPLOAD, tenantId: claim.insurerTenantId, targetType: 'ClaimLetter', targetId: letter.id, metadata: { claimId } });
    return letter;
  }

  async getLetterFile(claimId: string, letterId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const l = await db.claimLetter.findFirst({ where: { id: letterId, claimId } });
    if (!l?.storageKey) throw new NotFoundException('فایل نامه یافت نشد');
    const buffer = await this.storage.read(l.storageKey);
    await this.audit.record({ action: AuditAction.VIEW, tenantId: claim.insurerTenantId, targetType: 'ClaimLetterFile', targetId: letterId });
    return { buffer, mimeType: l.mimeType ?? 'application/octet-stream', fileName: l.fileName ?? 'letter' };
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
    await this.notifyAdminsActivity('ثبت مبلغ قطعی خسارت', `${await this.actorLabel()} مبلغ قطعی خسارت پروندهٔ ${claim.claimNumber} را ثبت کرد.`, `/org/claims/${claimId}`);
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
      await this.notifyAdminsActivity('حذف پرونده', `${await this.actorLabel()} پروندهٔ ${claim.claimNumber} را حذف کرد (تا ${CLAIM_RETENTION_DAYS} روز قابل بازیابی).`, '/org/claims/trash');
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
      await this.notifyAdminsActivity('بازیابی پرونده', `${await this.actorLabel()} پروندهٔ ${claim.claimNumber} را از سطل بازیافت بازیابی کرد.`, `/org/claims/${claimId}`);
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
    const letters = await u.claimLetter.findMany({ where: { claimId, storageKey: { not: null } }, select: { storageKey: true } });
    await u.$transaction([
      u.documentReview.deleteMany({ where: { document: { claimId } } }), // FK RESTRICT → before documents
      u.claimPhysicalEvent.deleteMany({ where: { claimId } }), // before their requests
      u.claimPhysicalRequest.deleteMany({ where: { claimId } }),
      u.claimLetter.deleteMany({ where: { claimId } }),
      u.claimFieldValue.deleteMany({ where: { claimId } }),
      u.claimDeficiency.deleteMany({ where: { claimId } }),
      u.claimStep.deleteMany({ where: { claimId } }),
      u.claimParticipant.deleteMany({ where: { claimId } }),
      u.document.deleteMany({ where: { claimId } }),
      u.claim.delete({ where: { id: claimId } }),
    ]);
    for (const d of [...docs, ...letters]) {
      try { await this.storage.remove(d.storageKey!); } catch { /* orphan file is harmless */ }
    }
  }

  // ─────────────────────────── Reads ───────────────────────────
  async get(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true, letters: { orderBy: { createdAt: 'asc' } } } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const result: any = this.present(claim, true);
    await this.enrichParties(claim, result);
    result.workflow = await this.workflowView(claim);
    result.policyholderCompany = await this.policyholders.contact(claim.policyholderCompanyId);
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
    const branchIds = [...new Set([claim.sellingBranchId, claim.handlingBranchId, ...steps.map((s) => s.holderBranchId)].filter(Boolean))] as string[];
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
    result.handlingBranchName = claim.handlingBranchId ? (bMap.get(claim.handlingBranchId) ?? null) : null;

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
    // Per-document approvals at each desk (کارگزاری/شعبه/ستاد/شورای فنی).
    const docReviews = docs.length
      ? await db.documentReview.findMany({ where: { documentId: { in: docs.map((d) => d.id) } } })
      : [];
    const reviewsByDoc = new Map<string, Map<string, string>>();
    for (const r of docReviews) {
      if (!reviewsByDoc.has(r.documentId)) reviewsByDoc.set(r.documentId, new Map());
      reviewsByDoc.get(r.documentId)!.set(r.stage, r.state);
    }
    const applicableStages = await this.reviewDesks(claim);
    const desk = await this.myDesk();
    const canEditStage = Object.fromEntries(applicableStages.map((st) => [st, this.canReviewStage(claim, st, desk)])) as Record<string, boolean>;
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
    await this.notifyAdminsActivity('بررسی مدرک', `${await this.actorLabel()} وضعیت یکی از مدارک پروندهٔ ${claim.claimNumber} را «${DOC_STATUS_LABELS[status] ?? status}» ثبت کرد.`, `/org/claims/${claimId}`);
    return { ok: true };
  }

  /**
   * A desk may set its own ✓/✕ on documents only while it holds the claim on the way UP (doc:verify).
   * Desks: کارگزاری (broker org), شعبه (the claim's handling branch), مدیریت ستاد and شورای فنی (central
   * insurer users; OrgUser.desk = COUNCIL marks a council member).
   */
  private canReviewStage(claim: any, stage: ReviewDesk, desk: Desk): boolean {
    if (!(getContext()?.permissions ?? []).includes(PERMISSIONS.DOC_VERIFY)) return false;
    return claim.currentStage === stage && claim.flowDirection === 'UP' && desk.stage === stage && this.holdsDesk(claim, desk);
  }

  /** Review columns shown per document: the desks on this claim's chain (شورای فنی once it was referred). */
  private async reviewDesks(claim: any): Promise<ReviewDesk[]> {
    const referred = claim.currentStage === 'COUNCIL' || (await this.db().claimStep.count({ where: { claimId: claim.id, stage: 'COUNCIL' } })) > 0;
    return chainOf(claim).filter((s): s is ReviewDesk => s !== 'POLICYHOLDER' && (s !== 'COUNCIL' || referred));
  }

  /** Set a per-document approval at the caller's desk and roll it up to the doc status. */
  async reviewDocument(claimId: string, docId: string, stage: ReviewDesk, state: ReviewStateName, note?: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const desk = await this.myDesk();
    if (!this.canReviewStage(claim, stage, desk)) throw new ForbiddenException('بررسی مدارک این مرحله در حال حاضر در اختیار شما نیست');
    const doc = await db.document.findFirst({ where: { id: docId, claimId }, select: { id: true } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const ctx = getContext();
    const decidedAt = state === 'PENDING' ? null : new Date();
    await db.documentReview.upsert({
      where: { documentId_stage: { documentId: docId, stage } },
      update: { state, reviewerId: ctx?.actorId ?? null, note: note ?? null, decidedAt },
      create: { documentId: docId, stage, state, reviewerId: ctx?.actorId ?? null, note: note ?? null, decidedAt },
    });
    await this.recomputeDocStatus(docId, claim);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimDocumentReview', targetId: docId, metadata: { stage, state, note } });
    const stateFa = { PENDING: 'در انتظار', APPROVED: 'تایید', REJECTED: 'رد' }[state] ?? state;
    await this.notifyAdminsActivity('بررسی مدرک (مرحله‌ای)', `${await this.actorLabel()} در مرحلهٔ «${STAGE_FA[stage]}» یکی از مدارک پروندهٔ ${claim.claimNumber} را «${stateFa}» کرد.`, `/org/claims/${claimId}`);
    return { ok: true };
  }

  /**
   * Roll the desk reviews up into the document's overall verificationStatus (display only — moving
   * the claim is always an explicit action by the desk that holds it).
   */
  private async recomputeDocStatus(docId: string, claim: any) {
    const db = this.db();
    const reviews = await db.documentReview.findMany({ where: { documentId: docId } });
    const applicable = await this.reviewDesks(claim);
    const stateOf = (s: ReviewDesk) => reviews.find((r) => r.stage === s)?.state ?? 'PENDING';
    let status: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'PENDING';
    if (applicable.some((s) => stateOf(s) === 'REJECTED')) status = 'REJECTED';
    else if (applicable.every((s) => stateOf(s) === 'APPROVED')) status = 'VERIFIED';
    await db.document.update({ where: { id: docId }, data: { verificationStatus: status } });
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
  async listMine(q?: string) {
    const ctx = getContext();
    const db = this.db();
    const where: Prisma.ClaimWhereInput =
      ctx?.actorType === 'CUSTOMER'
        ? { policyHolderId: ctx.actorId, deletedAt: null }
        : this.wdScope(ctx?.tenantId);
    // Search (بیمه‌گزار panel «جستجو»): a 10-digit term matches the deceased's کد ملی exactly (blind
    // index); anything else matches the claim number or the deceased's name.
    const term = (q ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const nidHash = /^\d{8,10}$/.test(term) ? this.crypto.blindIndex(term.padStart(10, '0')) : null;
    const [rows, desk] = await Promise.all([
      db.claim.findMany({ where: nidHash ? { AND: [where, { deceasedNationalCodeHash: nidHash }] } : where, orderBy: { updatedAt: 'desc' } }),
      this.myDesk(),
    ]);
    const claims = term && !nidHash
      ? rows.filter((c) => c.claimNumber.toLowerCase().includes(term.toLowerCase()) || (this.crypto.decrypt(c.deceasedFullName) ?? '').includes(term))
      : rows;
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.holdsDesk(c, desk) }));
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

  /** Work queue: claims sitting at the caller's desk. */
  async queue() {
    const ctx = getContext();
    const desk = await this.myDesk();
    const where: Prisma.ClaimWhereInput = ctx?.actorType === 'CUSTOMER'
      ? { policyHolderId: ctx.actorId, deletedAt: null, currentStage: 'POLICYHOLDER' }
      : { AND: [this.wdScope(ctx?.tenantId), this.deskWhere(desk)] };
    const claims = await this.db().claim.findMany({ where, orderBy: { updatedAt: 'desc' } });
    return claims.filter((c) => this.holdsDesk(c, desk)).map((c) => this.present(c));
  }

  /** Claim scope visible to the caller (insurer/broker/participant), excluding soft-deleted. */
  private wdScope(tenantId: string | undefined): Prisma.ClaimWhereInput {
    return { deletedAt: null, OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }, { participants: { some: { tenantId: tenantId ?? undefined } } }] };
  }

  /** SQL pre-filter for "claims at my desk" (holdsDesk is the exact check). */
  private deskWhere(desk: Desk): Prisma.ClaimWhereInput {
    if (!desk.stage) return { id: '__none__' };
    const w: Prisma.ClaimWhereInput = { currentStage: desk.stage };
    if (desk.stage === 'BRANCH' && desk.branchId) w.OR = [{ handlingBranchId: desk.branchId }, { handlingBranchId: null }];
    return w;
  }

  /** Work Desk queues: key → filter. Review queues hold claims climbing UP at that desk. */
  private wdQueues(): Record<string, { label: string; where: Prisma.ClaimWhereInput; desk?: Stage[] }> {
    const up = (s: Stage): Prisma.ClaimWhereInput => ({ currentStage: s, flowDirection: 'UP' });
    return {
      'stage-policyholder': { label: 'نزد بیمه‌گزار (تکمیل / رفع نقص)', where: { currentStage: 'POLICYHOLDER' } },
      'stage-broker': { label: 'در انتظار بررسی کارگزاری', where: up('BROKER'), desk: ['BROKER'] },
      'stage-branch': { label: 'در انتظار بررسی شعبه', where: up('BRANCH'), desk: ['BRANCH'] },
      'stage-hq': { label: 'در انتظار بررسی مدیریت ستاد', where: up('HQ'), desk: ['HQ'] },
      'stage-council': { label: 'در انتظار بررسی شورای فنی', where: up('COUNCIL'), desk: ['COUNCIL'] },
      'returning': { label: 'عودت‌شده — در انتظار ارسال به سطح پایین‌تر', where: { flowDirection: 'DOWN', flowPurpose: 'DEFICIENCY', currentStage: { not: 'POLICYHOLDER' } }, desk: ['BROKER', 'BRANCH', 'HQ'] },
      'to-pay': { label: 'دستور پرداخت — در انتظار پرداخت', where: { flowPurpose: 'PAYMENT', status: ClaimStatus.APPROVED }, desk: ['BRANCH', 'HQ'] },
      'physical': { label: 'اصل مدارک — درخواست‌های باز', where: { physicalRequests: { some: { status: { in: ['REQUESTED', 'SENT'] } } } }, desk: ['BRANCH', 'HQ', 'COUNCIL'] },
      'paid': { label: 'پرداخت‌شده', where: { status: ClaimStatus.PAID } },
      'rejected': { label: 'ردشده', where: { status: ClaimStatus.REJECTED } },
    };
  }

  /**
   * میز کار (Work Desk): the whole chain as queue tiles with live counts, scoped to the caller's claims,
   * so every desk can follow a case end-to-end. `actionable` marks the queues where claims sit at the
   * caller's own desk, and `mine` counts how many of those the caller can act on right now.
   */
  async workDesk() {
    const ctx = getContext();
    const db = this.db();
    const desk = await this.myDesk();
    const scope = this.wdScope(ctx?.tenantId);
    const perms = new Set(ctx?.permissions ?? []);

    type Tile = { key: string; label: string; count: number; actionable: boolean; mine: number; href?: string };
    const tiles: Tile[] = [];
    if (perms.has(PERMISSIONS.CLAIM_READ)) {
      const allCount = await db.claim.count({ where: scope });
      tiles.push({ key: 'all', label: 'همه پرونده‌ها', count: allCount, actionable: false, mine: 0, href: '/org/claims' });
      for (const [key, q] of Object.entries(this.wdQueues())) {
        const rows = await db.claim.findMany({ where: { AND: [scope, q.where] }, select: { id: true, currentStage: true, flowDirection: true, handlingBranchId: true, brokerTenantId: true, insurerTenantId: true, policyHolderId: true, imported: true } });
        const mine = key === 'physical'
          // requests waiting on my desk: to send/relay (REQUESTED with me) or to confirm receipt (SENT to me)
          ? (desk.stage ? await db.claim.count({ where: { AND: [scope, { physicalRequests: { some: { OR: [{ status: 'REQUESTED', holderStage: desk.stage }, { status: 'SENT', requesterStage: desk.stage }] } } }] } }) : 0)
          : rows.filter((c) => this.holdsDesk(c, desk)).length;
        tiles.push({ key, label: q.label, count: rows.length, actionable: !!desk.stage && !!q.desk?.includes(desk.stage), mine });
      }
    }

    const pendingActions = tiles.reduce((s, t) => s + t.mine, 0);
    const user = ctx?.actorId ? await db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { displayName: true, username: true } }) : null;
    return {
      userName: user?.displayName || user?.username || null,
      role: desk.stage,
      roleLabel: desk.stage ? STAGE_FA[desk.stage] : '—',
      tiles,
      summary: { pendingActions, queues: tiles.filter((t) => t.mine > 0).length },
    };
  }

  /** The claim list for one Work Desk queue (for the tile → list view). */
  async workDeskQueue(key: string) {
    const scope = this.wdScope(getContext()?.tenantId);
    let where: Prisma.ClaimWhereInput;
    const q = this.wdQueues()[key];
    if (q) where = { AND: [scope, q.where] };
    else if (key === 'all') where = scope;
    else throw new BadRequestException('صف نامعتبر است');
    const [claims, desk] = await Promise.all([this.db().claim.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 }), this.myDesk()]);
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.holdsDesk(c, desk) }));
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

    // Document-type filter: claims that have an uploaded document of the given required-doc code
    // (any claim kind). Claim has no documents relation, so resolve claimIds via the Document table.
    if (clean(q.docCode)) {
      const dc = await db.document.findMany({ where: { docCode: clean(q.docCode) }, select: { claimId: true }, distinct: ['claimId'] });
      and.push({ id: { in: dc.map((d) => d.claimId).filter((x): x is string => !!x) } });
    }

    let claims = await db.claim.findMany({ where: { AND: and }, orderBy: { updatedAt: 'desc' }, take: 300 });
    if (clean(q.deceasedName)) {
      const term = clean(q.deceasedName);
      claims = claims.filter((c) => { const n = c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : ''; return (n ?? '').includes(term); });
    }
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: false }));
  }

  /**
   * Required-document catalog for the «نوع مدرک» search filter — the distinct document types across
   * every claim kind, for the insurers the caller can see (their own, or a broker's partner insurers).
   */
  async docTypes() {
    const ctx = getContext();
    const db = this.db();
    const tenantId = ctx?.tenantId;
    if (!tenantId) return [];
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    let insurerIds: string[] = [];
    if (tenant?.kind === 'INSURER') insurerIds = [tenantId];
    else if (tenant?.kind === 'BROKER') {
      const parts = await db.brokerInsurerPartnership.findMany({ where: { brokerTenantId: tenantId, isActive: true }, select: { insurerTenantId: true } });
      insurerIds = parts.map((p) => p.insurerTenantId);
    }
    if (!insurerIds.length) return [];
    const docs = await db.requiredDocument.findMany({ where: { tenantId: { in: insurerIds }, isActive: true }, orderBy: { order: 'asc' }, select: { code: true, label: true, appliesToTypes: true } });
    const seen = new Set<string>();
    const out: { code: string; label: string; appliesToTypes: string[] }[] = [];
    for (const d of docs) { if (!seen.has(d.code)) { seen.add(d.code); out.push({ code: d.code, label: d.label, appliesToTypes: d.appliesToTypes as string[] }); } }
    return out;
  }

  // ─────────────────────────── Helpers ───────────────────────────
  private assertParticipant(claim: any) {
    const ctx = getContext();
    if (ctx?.actorType === 'SUPER_ADMIN') return;
    if (ctx?.actorType === 'CUSTOMER' && claim.policyHolderId === ctx.actorId) return;
    if (ctx?.actorType === 'ORG_USER' && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId)) return;
    throw new ForbiddenException('دسترسی به این پرونده ندارید');
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
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { steps: { orderBy: { order: 'asc' } }, deficiencies: true, letters: { orderBy: { createdAt: 'asc' } } } });
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
      deceasedBirthDate: c.deceasedBirthDate ? toJalali(c.deceasedBirthDate, false) : null,
      deceasedAge: ageAt(c.deceasedBirthDate, c.eventDate),
      policyholderCompanyId: c.policyholderCompanyId ?? null,
      noticeDeadline: c.noticeDeadline ? toJalali(c.noticeDeadline, false) : null,
      lateNotice: c.lateNotice,
      createdAt: c.createdAt ? toJalali(c.createdAt) : null,
      currentStage: c.currentStage ?? null,
      currentStageLabel: c.currentStage ? STAGE_FA[c.currentStage as Stage] : null,
      flowDirection: c.flowDirection ?? null,
      flowPurpose: c.flowPurpose ?? null,
    };
    if (!full) return base;
    return {
      ...base,
      steps: (c.steps ?? []).map((s: any) => ({
        order: s.order, partyType: s.partyType, stage: s.stage ?? null, stageLabel: s.stage ? STAGE_FA[s.stage as Stage] : null,
        direction: s.direction, purpose: s.purpose ?? null, state: s.state, action: s.action ?? null,
        levelId: s.levelId, holderTenantId: s.holderTenantId, note: s.note, decidedAt: s.decidedAt ? toJalali(s.decidedAt) : null,
        letters: (c.letters ?? []).filter((l: any) => l.stepId === s.id).map((l: any) => ({
          id: l.id, number: l.number, subject: l.subject, date: l.letterDate ? toJalali(l.letterDate, false) : null, hasFile: !!l.storageKey, fileName: l.fileName,
        })),
      })),
      deficiencies: (c.deficiencies ?? []).map((d: any) => ({ items: safeParse(d.items), raisedByStepId: d.raisedByStepId, createdAt: d.createdAt ? toJalali(d.createdAt) : null, resolvedAt: d.resolvedAt ? toJalali(d.resolvedAt) : null })),
    };
  }
}

/** Whole years between birth and the date of death (or today when the event date is unknown). */
export function ageAt(birth: Date | null | undefined, at: Date | null | undefined): number | null {
  if (!birth) return null;
  const end = at ?? new Date();
  let age = end.getUTCFullYear() - birth.getUTCFullYear();
  if (end.getUTCMonth() < birth.getUTCMonth() || (end.getUTCMonth() === birth.getUTCMonth() && end.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
