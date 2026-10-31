import { assertNotPaid } from './archived';
import JSZip from 'jszip';
import { uploadName } from '../../common/validation/upload-name';
import { NoticeRule, NoticeSource, NoticeTarget, SOURCE_FA, TARGET_FA, TARGETS_OF, combine, rulesFor } from './claim-notice';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimStatus, ClaimType, Prisma, SalesChannel } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { customerClaimWhere, customerOwnsClaim, getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { toJalali, toPersianDigits } from '../../common/jalali/jalali.util';
import { OcrService } from '../../integrations/ocr/ocr.service';
import { ClaimFieldsService } from '../claim-fields/claim-fields.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyholdersService } from '../policyholders/policyholders.service';
import { AiReviewQueue } from '../ai-review/ai-review.queue';
import { AiReviewSettings } from '../ai-review/ai-review.settings';
import { sha256 } from '../ai-review/ai-review.queue';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { nextClaimNumber } from './claim-number';
import { above, actionsFor, ActionKey, below, chainOf, DeskDocFacts, Direction, higher, physicalActionsFor, PhysicalActionKey, physicalBelow, PhysicalState, Purpose, ReviewDesk, Stage, STAGE_FA, WorkflowAction } from './workflow';

const CLAIM_DOC_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // Word
]);
const CLAIM_DOC_EXT = /\.(pdf|jpe?g|png|docx?)$/i;
/** PDF, image or Word. Some browsers send Word files as application/octet-stream, so the extension decides then. */
const claimDocOk = (f: Express.Multer.File) =>
  CLAIM_DOC_MIME.has(f.mimetype) || (f.mimetype === 'application/octet-stream' && CLAIM_DOC_EXT.test(f.originalname ?? ''));
const CLAIM_DOC_TYPES_FA = 'فقط PDF، Word (DOC، DOCX)، JPG و PNG مجاز است';
// «فایل ذینفع» (list of heirs/beneficiaries and their shares) may also be an Excel sheet.
export const BENEFICIARY_FILE_CODE = 'BENEFICIARY_FILE';
const EXCEL_MIME = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']);

// How long a soft-deleted claim stays restorable before the daily purge removes it for good.
export const CLAIM_RETENTION_DAYS = 14;

type ReviewStateName = 'PENDING' | 'APPROVED' | 'REJECTED';

const DOC_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در دست بررسی',
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
  /** بیمه‌گزار panel: the company's بیمه‌نامه (PolicyholderContract) the claim is filed under. */
  contractId?: string;
  claimedAmount?: string;
  description?: string; // free-text details (used when بیمه‌گزار files, can't know amount/policy)
  deceasedFullName: string;
  deceasedNationalCode: string;
  deceasedBirthDate?: string; // ISO
  causeOfDeath?: string; // علت فوت, typed by whoever files (free text)
  policyHolderId?: string;
  policyholderCompanyId?: string; // بیمه‌گزار company (set automatically when the بیمه‌گزار files)
  onBehalf?: boolean; // کارگزاری files *as* the بیمه‌گزار company (claim:file-on-behalf) — starts at their desk
  /** «اعلام خسارت به»: the desk the new case starts on (must be allowed by the org's rules). */
  startStage?: NoticeTarget;
  /** Start desk شعبه: which branch (optional — any branch of the insurer when empty). */
  branchId?: string;
}

/** The caller's seat in the claim chain (see myDesk). */
interface Desk {
  stage: Stage | null;
  tenantId: string | null;
  branchId: string | null;
  isAdmin: boolean; // claim:override — may skip desks on the way down (management discretion)
  /** An insurer's admin (claim:override in an insurer org) also sits at every insurer desk: شعبه, ستاد, شورای فنی. */
  insurerAdmin?: boolean;
}

const INSURER_DESKS: Stage[] = ['BRANCH', 'HQ', 'COUNCIL'];

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
    private readonly aiSettings: AiReviewSettings,
    private readonly aiQueue: AiReviewQueue,
    private readonly rateLimit: RateLimitService,
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
    return this.prisma.party(); // the database shows an organization only the cases it is named on
  }

  // ─────────────────────────── Filing ───────────────────────────
  /**
   * کارگزاری staff with claim:file-on-behalf open a case for one of their بیمه‌گزار companies (when the
   * company asks the brokerage to do the job for them). The insurer comes from the company's contract.
   */
  async fileOnBehalf(input: Omit<FileClaimInput, 'channel' | 'insurerTenantId' | 'brokerTenantId' | 'sellingBranchId' | 'onBehalf'> & { policyholderCompanyId: string }) {
    const ctx = getContext();
    const company = await this.db().policyholderCompany.findUnique({ where: { id: input.policyholderCompanyId }, select: { tenantId: true, isActive: true } });
    if (!company || company.tenantId !== ctx?.tenantId) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
    if (!company.isActive) throw new BadRequestException('این شرکت بیمه‌گزار غیرفعال است');
    if (input.policyHolderId) {
      const acc = await this.db().customerAccount.findUnique({ where: { id: input.policyHolderId }, select: { companyId: true } });
      if (acc?.companyId !== input.policyholderCompanyId) throw new BadRequestException('نماینده انتخاب‌شده متعلق به این شرکت نیست');
    }
    return this.file({ ...input, channel: 'BROKER' as SalesChannel, onBehalf: true });
  }

  /** Companies the caller's brokerage serves, with their current insurer and representatives — for the on-behalf form. */
  async onBehalfCompanies() {
    const companies = (await this.policyholders.list()).filter((c) => c.isActive);
    const accounts = companies.length
      ? await this.prisma.scoped.customerAccount.findMany({ where: { companyId: { in: companies.map((c) => c.id) } }, select: { id: true, companyId: true, fullName: true } })
      : [];
    return companies.map((c) => ({
      id: c.id, name: c.name, hasLogo: c.hasLogo, currentInsurer: c.currentInsurer,
      contracts: c.contracts.filter((k) => k.isActive).map((k) => ({ insurerName: k.insurerName, policyNumber: k.policyNumber, startDate: k.startDate, endDate: k.endDate, isCurrent: k.isCurrent })),
      accounts: accounts.filter((a) => a.companyId === c.id).map((a) => ({ id: a.id, fullName: this.crypto.decrypt(a.fullName) ?? 'بی‌نام' })),
    }));
  }

  async file(input: FileClaimInput) {
    const db = this.db();
    const ctx = getContext();
    const eventDate = input.eventDate ? new Date(input.eventDate) : null;

    // A بیمه‌گزار doesn't choose the insurer: the brokerage's contract for their company that covered
    // the date of death decides it (and supplies the policy number).
    let companyId = input.policyholderCompanyId ?? null;
    if (companyId && ctx?.actorType === 'ORG_USER') {
      // Staff may link only a company their own brokerage serves.
      const co = await db.policyholderCompany.findUnique({ where: { id: companyId }, select: { tenantId: true } });
      if (!co || co.tenantId !== ctx.tenantId) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
      if (input.policyHolderId) {
        const acc = await db.customerAccount.findUnique({ where: { id: input.policyHolderId }, select: { companyId: true } });
        if (acc?.companyId !== companyId) throw new BadRequestException('نماینده انتخاب‌شده متعلق به این شرکت نیست');
      }
    }
    if (ctx?.actorType === 'CUSTOMER' && ctx.customerBrokerPanel) {
      // The brokerage's «broker» login files for a company of its own brokerage.
      const co = input.policyholderCompanyId ? await db.policyholderCompany.findFirst({ where: { id: input.policyholderCompanyId, tenantId: ctx.tenantId }, select: { id: true } }) : null;
      if (!co) throw new BadRequestException('بیمه‌گزار را انتخاب کنید');
      companyId = co.id;
      input.insurerTenantId = undefined;
    } else if (ctx?.actorType === 'CUSTOMER') {
      const acc = await db.customerAccount.findUnique({ where: { id: ctx.actorId }, select: { companyId: true } });
      if (!acc?.companyId) throw new BadRequestException('حساب شما هنوز به شرکت بیمه‌گزار متصل نشده است؛ لطفاً با کارگزاری تماس بگیرید.');
      companyId = acc.companyId;
      input.insurerTenantId = undefined;
    }
    if (companyId && input.contractId) {
      // The بیمه‌نامه the بیمه‌گزار picked: it must be theirs, fit the claim type, and cover the date.
      const contract = await this.policyholders.contractForClaim(companyId, input.contractId, input.claimType ?? null, eventDate);
      input.insurerTenantId = contract.insurerTenantId;
      input.policyNumber = contract.policyNumber ?? input.policyNumber ?? undefined;
    }
    if (companyId && !input.insurerTenantId) {
      const contract = await this.policyholders.resolveContract(companyId, eventDate, input.claimType ?? null);
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

    // «اعلام خسارت» rules decide whether this panel may report a claim and on which desk it starts. By
    // default the بیمه‌گزار keeps a claim they filed until they press «ارسال به …» (documents first), and
    // filing on behalf starts at the بیمه‌گزار desk too; an operator's own filing goes to their desk.
    const notice = await this.noticeOptions(input.channel === 'BROKER' ? input.brokerTenantId! : null, insurerTenantId);
    if (!notice.enabled) throw new ForbiddenException('اعلام خسارت از این پنل غیرفعال است؛ با مدیر سازمان تماس بگیرید.');
    const wanted = input.startStage ?? (input.onBehalf && notice.targets.includes('POLICYHOLDER') ? 'POLICYHOLDER' : notice.default);
    if (!notice.targets.includes(wanted)) throw new BadRequestException('ارسال پرونده به این مرحله در تنظیمات اعلام خسارت مجاز نیست.');
    if (wanted === 'BROKER' && input.channel !== 'BROKER') throw new BadRequestException('این پرونده کارگزاری ندارد؛ مرحلهٔ دیگری را انتخاب کنید.');
    const firstStage: Stage = wanted as Stage;
    const byPolicyHolder = firstStage === 'POLICYHOLDER';
    let startBranchId = moarefBranchId;
    if (firstStage === 'BRANCH' && !startBranchId && input.branchId) {
      const b = await db.branch.findFirst({ where: { id: input.branchId, tenantId: insurerTenantId }, select: { id: true } });
      if (!b) throw new BadRequestException('شعبه متعلق به بیمه‌گر پرونده نیست');
      startBranchId = b.id;
    }

    const nid = input.deceasedNationalCode;
    // Numbering must see every case with this policy number (other brokerages' too), or it could pick a
    // number already taken: the unrestricted client, which returns only numbers.
    const claimNumber = await nextClaimNumber(this.prisma.unscoped() as any, input.policyNumber); // «سال/شماره بیمه‌نامه/n»
    const claim = await db.claim.create({
      data: {
        claimNumber,
        insurerTenantId: insurerTenantId,
        channel: input.channel,
        brokerTenantId: input.channel === 'BROKER' ? input.brokerTenantId : null,
        sellingBranchId: moarefBranchId,
        // The filing بیمه‌گزار account: the caller when a بیمه‌گزار files, else the representative staff picked (if any).
        policyHolderId: input.policyHolderId ?? (ctx?.actorType === 'CUSTOMER' ? ctx.actorId : null) ?? null,
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
        causeOfDeath: input.causeOfDeath?.trim() || null,
        status: byPolicyHolder ? ClaimStatus.SUBMITTED : ClaimStatus.UNDER_REVIEW,
        currentStage: firstStage,
        flowDirection: 'UP',
        flowPurpose: 'REVIEW',
        handlingBranchId: startBranchId,
        participants: {
          create: [
            { tenantId: insurerTenantId, role: 'INSURER' },
            ...(input.channel === 'BROKER' ? [{ tenantId: input.brokerTenantId!, role: 'MOAREF_BROKER' }] : []),
          ],
        },
        steps: {
          create: [{
            order: 1,
            partyType: firstStage === 'POLICYHOLDER' ? 'POLICYHOLDER' : firstStage === 'BROKER' || (firstStage === 'BRANCH' && moarefBranchId) ? 'MOAREF' : 'INSURER_LEVEL',
            stage: firstStage,
            purpose: 'REVIEW',
            holderTenantId: firstStage === 'BROKER' ? moarefTenantId : insurerTenantId,
            holderBranchId: firstStage === 'BRANCH' ? startBranchId : null,
            state: 'PENDING',
            direction: 'UP',
          }],
        },
      },
      include: { steps: true },
    });

    await this.audit.record({ action: AuditAction.CLAIM_SUBMIT, tenantId: insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { channel: input.channel, moaref: moarefRole, ...(input.onBehalf ? { onBehalf: true, companyId } : {}) } });
    if (byPolicyHolder) {
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد؛ مدارک را بارگذاری و پرونده را ارسال کنید.`);
    } else {
      await this.notifyOrg(firstStage === 'BROKER' ? moarefTenantId : insurerTenantId, 'پرونده خسارت جدید', `پرونده ${claim.claimNumber} برای بررسی به میز کار شما رسید.`);
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد و در حال بررسی است.`);
    }
    return this.present(claim);
  }

  /**
   * «اعلام خسارت» for the caller: may they report a claim, and on which desks may it start? The
   * brokerage's rules cover بیمه‌گزار / نماینده / its operators; the insurer's cover its desks and نمایندگان.
   * With `brokerTenantId` / `insurerTenantId` unknown (before the form is filled) the caller's own org
   * decides, and the insurer is checked again when the claim is filed.
   */
  async noticeOptions(brokerTenantId?: string | null, insurerTenantId?: string | null): Promise<NoticeRule & { source: NoticeSource; labels: Record<string, string> }> {
    const ctx = getContext();
    const db = this.db();
    let source: NoticeSource;
    if (ctx?.actorType === 'CUSTOMER') source = ctx.customerRepresentative ? 'REPRESENTATIVE' : 'POLICYHOLDER';
    else source = ((await this.myDesk()).stage ?? 'BROKER') as NoticeSource;
    const brokerId = brokerTenantId ?? (ctx?.actorType === 'CUSTOMER' || source === 'BROKER' ? ctx?.tenantId : null);
    const insurerId = insurerTenantId ?? (['BRANCH', 'HQ', 'COUNCIL'].includes(source) ? ctx?.tenantId : null);
    const orgs = await db.tenant.findMany({ where: { id: { in: [brokerId, insurerId].filter((x): x is string => !!x) } }, select: { id: true, kind: true, claimNoticeRules: true } });
    const rule = (id?: string | null) => { const t = orgs.find((o) => o.id === id); return t ? rulesFor(t.kind, t.claimNoticeRules)[source] : undefined; };
    const r = combine(rule(brokerId), rule(insurerId)) ?? { enabled: false, targets: [], default: 'POLICYHOLDER' as NoticeTarget };
    return { ...r, source, labels: TARGET_FA };
  }

  /** Org admin: this organization's «اعلام خسارت» rules (only the sources it decides for). */
  async noticeRules() {
    const t = await this.db().tenant.findUnique({ where: { id: getTenantIdOrThrow() }, select: { kind: true, claimNoticeRules: true } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    const rules = rulesFor(t.kind, t.claimNoticeRules);
    return {
      kind: t.kind,
      sources: Object.keys(rules).map((s) => ({ key: s, label: SOURCE_FA[s as NoticeSource], allowed: TARGETS_OF[s as NoticeSource].map((k) => ({ key: k, label: TARGET_FA[k] })), rule: rules[s as NoticeSource] })),
    };
  }

  async saveNoticeRules(input: Record<string, unknown>) {
    const id = getTenantIdOrThrow();
    const t = await this.db().tenant.findUnique({ where: { id }, select: { kind: true } });
    if (!t) throw new NotFoundException('سازمان یافت نشد');
    const rules = rulesFor(t.kind, input); // keeps only valid sources / desks
    await this.db().tenant.update({ where: { id }, data: { claimNoticeRules: rules as Prisma.InputJsonValue } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: id, targetType: 'ClaimNoticeRules', metadata: rules as Record<string, unknown> });
    return this.noticeRules();
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
    const isAdmin = (ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_OVERRIDE);
    return { stage, tenantId: ctx.tenantId, branchId, isAdmin, insurerAdmin: isAdmin && tenant?.kind === 'INSURER' };
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
      if (ctx?.actorType === 'CUSTOMER') return customerOwnsClaim(claim);
      return ctx?.actorType === 'ORG_USER' && (ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_FILE) && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId);
    }
    // The insurer's admin can evaluate and move a case at any of its own desks (e.g. a branch's cases).
    if (desk.insurerAdmin && INSURER_DESKS.includes(s)) return desk.tenantId === claim.insurerTenantId;
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
    assertNotPaid(claim); // archived once paid
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
          ? `نقص مدارک پروندهٔ ${claim.claimNumber} رفع شد؛ مدارک اصلاح‌شده در دست بررسی شماست.`
          : `پروندهٔ ${claim.claimNumber} برای بررسی به میز کار شما رسید.`);
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

  /**
   * «تکمیل دستی پرونده»: when the brokerage fills an outcome field by hand from «ویرایش», the case itself
   * follows — paid / rejected close it (the open step is closed as a manual entry, so the timeline shows
   * it), and an approval or payment order marks it approved. Cases moved by the hierarchy are untouched
   * by this unless such a field is typed; nothing here changes how the desks' own actions work.
   */
  async applyManualOutcome(claimId: string, key: string, value: string | null) {
    const v = (value ?? '').trim();
    const outcome = key === 'payment_order_status' && v === 'پرداخت شد' ? 'PAID'
      : key === 'council_approve_status' && v === 'رد شد' ? 'REJECTED'
      : (key === 'council_approve_status' && v === 'پرونده تایید شد') || (key === 'payment_order_status' && v === 'حواله پرداخت ثبت شد') ? 'APPROVED'
      : null;
    if (!outcome) return;
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt || !(await this.fields.manualMode(claim))) return;
    if (claim.status === outcome || claim.status === 'PAID' || claim.status === 'REJECTED') return;
    const note = 'ثبت دستی توسط کارگزاری (تکمیل دستی پرونده)';
    if (outcome === 'APPROVED') {
      await db.claim.update({ where: { id: claimId }, data: { status: ClaimStatus.APPROVED } });
    } else {
      const step = await db.claimStep.findFirst({ where: { claimId, state: 'PENDING' }, orderBy: { order: 'desc' } });
      const status = outcome === 'PAID' ? ClaimStatus.PAID : ClaimStatus.REJECTED;
      if (step) await this.move(claim, step, { action: outcome === 'PAID' ? 'MARK_PAID' : 'REJECT_FINAL', closeState: outcome === 'PAID' ? 'ACKED' : 'REJECTED', note, to: null, status });
      else await db.claim.update({ where: { id: claimId }, data: { status, currentStage: null, flowDirection: null, flowPurpose: null } });
      await this.notifyPolicyHolder(claim.policyHolderId, outcome === 'PAID' ? 'پرداخت خسارت' : 'رد پرونده خسارت',
        outcome === 'PAID' ? `خسارت پروندهٔ ${claim.claimNumber} پرداخت شد.` : `پروندهٔ ${claim.claimNumber} رد شد.`);
    }
    await this.audit.record({
      action: outcome === 'PAID' ? AuditAction.CLAIM_PAY : outcome === 'REJECTED' ? AuditAction.CLAIM_REJECT : AuditAction.CLAIM_APPROVE,
      tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { manual: true, key, value: v },
    });
  }

  /** Tell whoever now holds the claim: the بیمه‌گزار, or the holding org's inbox. */
  private async notifyHolder(claim: any, to: Stage, title: string, body: string) {
    if (to === 'POLICYHOLDER') return this.notifyPolicyHolder(claim.policyHolderId, title, body);
    const tenantId = to === 'BROKER' ? claim.brokerTenantId : claim.insurerTenantId;
    if (tenantId) await this.notifyOrg(tenantId, title, `${body} (مرحله: ${STAGE_FA[to]})`, `/org/claims/${claim.id}`);
  }

  /** بیمه‌گزار sends the claim on — initial submission or after رفع نقص. */
  /** Field values of a claim for a party that may only read them (the بیمه‌گزار's «روند پرونده»). */
  async fieldsReadOnly(claimId: string) {
    const d = await this.fields.listForClaim(claimId);
    for (const g of Object.values(d.groups)) for (const f of g as any[]) f.canEdit = false;
    return d;
  }

  async rectify(claimId: string, note?: string) {
    return this.act(claimId, { action: 'SUBMIT', note });
  }

  /** شعبه records اعلام خسارت (the loss registered in the insurer's own system) before forwarding. */
  async setLossNotice(claimId: string, number: string, date?: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
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
    assertNotPaid(claim); // archived once paid
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
    assertNotPaid(claim); // archived once paid
    if (!input.number?.trim() && !file?.buffer?.length) throw new BadRequestException('شمارهٔ نامه یا فایل نامه الزامی است');
    let stored: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (file?.buffer?.length) {
      if (!claimDocOk(file)) throw new BadRequestException(CLAIM_DOC_TYPES_FA);
      stored = { storageKey: await this.storage.save(claim.insurerTenantId, file.buffer), fileName: uploadName(file.originalname), mimeType: file.mimetype, sizeBytes: file.size };
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
    assertNotPaid(claim); // archived once paid
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
      select: { id: true, claimNumber: true, insurerTenantId: true, brokerTenantId: true, policyHolderId: true, policyholderCompanyId: true, deletedAt: true, status: true },
    });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
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
      select: { id: true, claimNumber: true, insurerTenantId: true, brokerTenantId: true, policyHolderId: true, policyholderCompanyId: true, deletedAt: true },
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
        ? { ...customerClaimWhere(), deletedAt: { not: null } }
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

  // ── Super admin: cases brought in by «ورود دسته‌ای» (imported = true) ──
  /** Imported cases, newest first, optionally of one org and matching a claim / policy number or name. */
  async listImported(tenantId?: string, q?: string) {
    const term = (q ?? '').trim();
    const rows = await this.db().claim.findMany({
      where: {
        imported: true,
        ...(tenantId ? { OR: [{ insurerTenantId: tenantId }, { brokerTenantId: tenantId }] } : {}),
        ...(term ? { AND: [{ OR: [{ claimNumber: { contains: term, mode: 'insensitive' } }, { policyNumber: { contains: term } }, { employerName: { contains: term, mode: 'insensitive' } }] }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const tIds = [...new Set(rows.flatMap((r) => [r.insurerTenantId, r.brokerTenantId].filter((x): x is string => !!x)))];
    const tenants = tIds.length ? await this.db().tenant.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true } }) : [];
    const tName = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({
      id: r.id, claimNumber: r.claimNumber, policyNumber: r.policyNumber, status: r.status, legacyStatus: r.legacyStatus,
      deceasedName: r.deceasedFullName ? this.crypto.decrypt(r.deceasedFullName) : null, employerName: r.employerName,
      insurerName: tName.get(r.insurerTenantId) ?? '—', brokerName: r.brokerTenantId ? tName.get(r.brokerTenantId) ?? '—' : '—',
      eventDate: r.eventDate ? toJalali(r.eventDate, false) : null, createdAt: toJalali(r.createdAt), deleted: !!r.deletedAt,
    }));
  }

  /** Permanently delete imported cases (only ones with imported = true; anything else is ignored). */
  async purgeImported(ids: string[]) {
    const rows = await this.db().claim.findMany({ where: { id: { in: [...new Set(ids)] }, imported: true }, select: { id: true, claimNumber: true, insurerTenantId: true } });
    for (const r of rows) {
      await this.hardDelete(r.id);
      await this.audit.record({ action: AuditAction.DELETE, tenantId: r.insurerTenantId, targetType: 'Claim', targetId: r.id, metadata: { claimNumber: r.claimNumber, imported: true, by: 'super', permanent: true } });
    }
    return { deleted: rows.length, ignored: ids.length - rows.length };
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
    // «ویرایش» first: a hand-completed case tells its typed story; otherwise the hierarchy's.
    result.story = await this.fields.statusStory(claim);
    if (result.story.manual) {
      // Hand-completed: the typed «وضعیت پرونده» and payment date, not the hierarchy's position / hand-off.
      const pay = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key: 'payment_order_date' } }, select: { value: true } });
      result.currentStageLabel = result.story.caseStage;
      result.paidDate = pay?.value ? toPersianDigits(pay.value) : null;
    }
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
      select: { id: true, docCode: true, fileName: true, verificationStatus: true, verificationNote: true, createdAt: true, uploadedBy: true, aiStatus: true, aiReason: true, aiDetectedCode: true },
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
    const reviewRow = new Map<string, (typeof docReviews)[number]>(); // `${docId}|${stage}` → latest decision
    for (const r of docReviews) {
      if (!reviewsByDoc.has(r.documentId)) reviewsByDoc.set(r.documentId, new Map());
      reviewsByDoc.get(r.documentId)!.set(r.stage, r.state);
      reviewRow.set(`${r.documentId}|${r.stage}`, r);
    }
    // How many times each desk changed its ✓/✕ on each document (every change is in the audit log).
    const changeCount = new Map<string, number>();
    if (docs.length) {
      const logs = await db.auditLog.findMany({ where: { targetType: 'ClaimDocumentReview', targetId: { in: docs.map((d) => d.id) } }, select: { targetId: true, metadata: true } });
      for (const l of logs) {
        const st = this.safeJson(l.metadata)?.stage;
        if (st) { const k = `${l.targetId}|${st}`; changeCount.set(k, (changeCount.get(k) ?? 0) + 1); }
      }
    }
    const reviewerIds = [...new Set(docReviews.map((r) => r.reviewerId).filter((x): x is string => !!x))];
    const reviewers = reviewerIds.length ? await db.orgUser.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, displayName: true, username: true } }) : [];
    const reviewerName = new Map(reviewers.map((u) => [u.id, u.displayName || u.username]));
    const isCustomer = getContext()?.actorType === 'CUSTOMER';
    const applicableStages = await this.reviewDesks(claim);
    const desk = await this.myDesk();
    const canEditStage = Object.fromEntries(applicableStages.map((st) => [st, this.canReviewStage(claim, st, desk)])) as Record<string, boolean>;
    // Present each docCode's uploads newest-first, with an explicit version number so admins can
    // tell new re-uploads from older ones at a glance. The newest is the "current" version.
    const labelOf = new Map(reqs.map((r) => [r.code, r.label]));
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
        // «بررسی هوشمند مدارک»: MISMATCH = refused (doesn't fill the slot), QUEUED/PROCESSING = being checked.
        ai: d.aiStatus ? { status: d.aiStatus, reason: d.aiReason ?? null, detected: d.aiDetectedCode && d.aiDetectedCode !== d.docCode ? (labelOf.get(d.aiDetectedCode) ?? null) : null } : null,
        reviews: applicableStages.map((st) => {
          const r = reviewRow.get(`${d.id}|${st}`);
          return {
            stage: st,
            state: reviewsByDoc.get(d.id)?.get(st) ?? 'PENDING',
            canEdit: canEditStage[st],
            // Last change (shown on hover) and how many changes there were (more than one → full history on click).
            changedAt: r ? toJalali(r.decidedAt ?? r.updatedAt) : null,
            // Operator names stay inside the organizations; the بیمه‌گزار sees the desk, time and reason.
            changedBy: r?.reviewerId && !isCustomer ? reviewerName.get(r.reviewerId) ?? null : null,
            note: r?.state === 'REJECTED' ? r.note ?? null : null, // why this desk rejected it
            changes: changeCount.get(`${d.id}|${st}`) ?? 0,
          };
        }),
      }));
    const items = reqs.map((r) => {
      const group = byCode.get(r.code) ?? [];
      const latest = group[0];
      return {
        code: r.code,
        label: r.label,
        appliesToTypes: r.appliesToTypes,
        uploaded: !!latest && latest.aiStatus !== 'MISMATCH', // a refused newest file leaves the slot to fix
        aiRefused: latest?.aiStatus === 'MISMATCH',
        latestStatus: latest?.verificationStatus ?? null,
        documents: present(group),
      };
    });
    const reqCodes = new Set(reqs.map((r) => r.code));
    return {
      claimType: claim.claimType,
      archived: claim.status === 'PAID', // a paid case takes no more uploads or reviews
      complete: items.length > 0 && items.every((i) => i.uploaded),
      items,
      // Each «سایر مدارک» file stands on its own (a batch upload is many documents, not versions of one).
      otherDocuments: docs.filter((d) => !d.docCode || !reqCodes.has(d.docCode)).flatMap((d) => present([d])),
    };
  }

  /** Approve / reject / request-info on a claim document. Org participants only (not the بیمه‌گزار). */
  async verifyDocument(claimId: string, docId: string, action: 'approve' | 'reject' | 'needs_info', note?: string) {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER') throw new ForbiddenException('تنها کارشناس سازمان می‌تواند مدارک را بررسی کند');
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    assertNotPaid(claim); // archived once paid
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
    return claim.currentStage === stage && claim.flowDirection === 'UP' && (desk.stage === stage || !!desk.insurerAdmin) && this.holdsDesk(claim, desk);
  }

  /** Review columns shown per document: the desks on this claim's chain (شورای فنی once it was referred). */
  private async reviewDesks(claim: any): Promise<ReviewDesk[]> {
    const referred = claim.currentStage === 'COUNCIL' || (await this.db().claimStep.count({ where: { claimId: claim.id, stage: 'COUNCIL' } })) > 0;
    return chainOf(claim).filter((s): s is ReviewDesk => s !== 'POLICYHOLDER' && (s !== 'COUNCIL' || referred));
  }

  /**
   * Every ✓/✕ change on one document, oldest first, explained in Persian («کارشناس احمدی در مرحلهٔ شعبه
   * این مدرک را تایید کرد»). Built from the audit log, which records each change with its operator.
   */
  async documentHistory(claimId: string, docId: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const doc = await db.document.findFirst({ where: { id: docId, claimId }, select: { id: true, fileName: true, docCode: true, createdAt: true } });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const logs = await db.auditLog.findMany({
      where: { targetId: docId, targetType: { in: ['ClaimDocumentReview', 'ClaimDocument'] } },
      orderBy: { createdAt: 'asc' },
      select: { actorId: true, actorType: true, action: true, targetType: true, metadata: true, createdAt: true },
    });
    const ids = [...new Set(logs.map((l) => l.actorId).filter((x): x is string => !!x))];
    const users = ids.length ? await db.orgUser.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } }) : [];
    const name = new Map(users.map((u) => [u.id, u.displayName || u.username]));
    const STATE_VERB: Record<string, string> = { APPROVED: 'تایید کرد', REJECTED: 'رد کرد', PENDING: 'تایید/رد قبلی را برداشت و به «در دست بررسی» برگرداند' };
    const entries = logs.map((l) => {
      const m = this.safeJson(l.metadata) ?? {};
      const who = (l.actorId && name.get(l.actorId)) || (l.actorType === 'CUSTOMER' || l.actorType === 'INSURED' ? 'بیمه‌گزار' : 'کاربر سامانه');
      let text: string;
      if (l.targetType === 'ClaimDocumentReview') {
        const stage = STAGE_FA[m.stage as Stage] ?? m.stage ?? '—';
        text = `${who} در مرحلهٔ «${stage}» این مدرک را ${STATE_VERB[m.state] ?? m.state}${m.note ? ` — توضیح: «${m.note}»` : ''}.`;
      } else if (l.action === 'UPLOAD') {
        text = `${who} این فایل را بارگذاری کرد.`;
      } else if (m.verify) {
        text = `${who} وضعیت کلی مدرک را «${DOC_STATUS_LABELS[m.verify] ?? m.verify}» ثبت کرد${m.note ? ` — توضیح: «${m.note}»` : ''}.`;
      } else {
        text = `${who} این مدرک را ویرایش کرد.`;
      }
      return { at: toJalali(l.createdAt), stage: m.stage ?? null, stageLabel: m.stage ? STAGE_FA[m.stage as Stage] ?? null : null, state: m.state ?? null, by: who, text };
    });
    return { documentId: doc.id, fileName: doc.fileName, entries };
  }

  private safeJson(s: string | null | undefined): any {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  /** Set a per-document approval at the caller's desk and roll it up to the doc status. */
  async reviewDocument(claimId: string, docId: string, stage: ReviewDesk, state: ReviewStateName, note?: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
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
    const stateFa = { PENDING: 'در دست بررسی', APPROVED: 'تایید', REJECTED: 'رد' }[state] ?? state;
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
    const excelOk = docCode?.trim() === BENEFICIARY_FILE_CODE && EXCEL_MIME.has(file.mimetype);
    if (!claimDocOk(file) && !excelOk) {
      throw new BadRequestException(docCode?.trim() === BENEFICIARY_FILE_CODE ? 'فقط PDF، Word یا اکسل مجاز است' : CLAIM_DOC_TYPES_FA);
    }
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
    return this.storeDocument(claim, file, docCode, getContext()?.actorId ?? null, () => this.uploaderPhone(claim));
  }

  /**
   * Save a claim document and, when «بررسی هوشمند مدارک» is on for the case, queue the AI check
   * (the uploader carries on; the verdict comes by SMS). Shared by the panels and the SMS re-upload link.
   */
  async storeDocument(
    claim: { id: string; insurerTenantId: string; brokerTenantId: string | null },
    file: Express.Multer.File, docCode: string, uploadedBy: string | null, notifyPhone: () => Promise<string | null>,
  ) {
    const claimId = claim.id;
    const db = this.prisma.unscoped(); // callers have already checked access to the case
    const storageKey = await this.storage.save(claim.insurerTenantId, file.buffer);
    const doc = await db.document.create({
      data: {
        tenantId: claim.insurerTenantId,
        claimId,
        docCode: docCode.trim(),
        kind: 'OTHER',
        fileName: uploadName(file.originalname),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedBy,
        verificationStatus: 'PENDING',
      },
      select: { id: true, docCode: true, fileName: true },
    });
    await this.audit.record({ action: AuditAction.UPLOAD, tenantId: claim.insurerTenantId, targetType: 'ClaimDocument', targetId: doc.id, metadata: { claimId, docCode } });
    let aiQueued = false;
    if (docCode.trim() !== BENEFICIARY_FILE_CODE && (await this.aiSettings.enabledForClaim(claim))) {
      await this.aiQueue.enqueue(doc.id, claimId, await notifyPhone().catch(() => null));
      aiQueued = true;
    }

    // OCR-assist (shadow mode): extract candidate field values as unconfirmed drafts for review.
    try {
      const result = await this.ocr.extract(file.buffer, file.mimetype, 'OTHER');
      const drafts = Object.entries(result.fields).map(([key, f]) => ({ key, value: f.value, confidence: f.confidence }));
      if (drafts.length) await this.fields.ingestOcrDraft(claimId, doc.id, drafts);
    } catch {
      /* OCR is best-effort; never block the upload */
    }
    return { ...doc, aiQueued };
  }

  /** Mobile of whoever is uploading (for the AI result SMS); falls back to the case's بیمه‌گزار. */
  private async uploaderPhone(claim: { policyHolderId: string | null }): Promise<string | null> {
    const ctx = getContext();
    const db = this.prisma.unscoped();
    let enc: string | null | undefined = null;
    if (ctx?.actorType === 'CUSTOMER' && ctx.actorId) enc = (await db.customerAccount.findUnique({ where: { id: ctx.actorId }, select: { phone: true } }))?.phone;
    else if (ctx?.actorType === 'ORG_USER' && ctx.actorId) enc = (await db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { phone: true } }))?.phone;
    if (!enc && claim.policyHolderId) enc = (await db.customerAccount.findUnique({ where: { id: claim.policyHolderId }, select: { phone: true } }))?.phone;
    return enc ? this.crypto.decrypt(enc) : null;
  }

  // ── «بارگذاری دوبارهٔ مدارک» link (sent by SMS when the AI refused files) ──

  private async linkClaim(token: string, ip: string) {
    if (!(await this.rateLimit.hit(`uplink:ip:${ip}`, 60, 3600))) throw new TooManyRequestsException('تعداد درخواست‌ها زیاد است. بعداً تلاش کنید.');
    if (!/^[\w-]{20,64}$/.test(token ?? '')) throw new NotFoundException('این پیوند معتبر نیست');
    const db = this.prisma.unscoped();
    const link = await db.caseUploadLink.findUnique({ where: { tokenHash: sha256(token) } });
    if (!link || link.expiresAt < new Date()) throw new NotFoundException('این پیوند معتبر نیست یا منقضی شده است');
    const claim = await db.claim.findFirst({ where: { id: link.claimId, deletedAt: null } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    return { link, claim };
  }

  /** What the link page shows: the case number and its refused documents (label + why). */
  async uploadLinkInfo(token: string, ip: string) {
    const { link, claim } = await this.linkClaim(token, ip);
    const refused = await this.aiQueue.refusedSlots(claim.id);
    const reqs = await this.prisma.unscoped().requiredDocument.findMany({ where: { tenantId: claim.insurerTenantId, code: { in: refused.map((r) => r.code) } }, select: { code: true, label: true } });
    const label = new Map(reqs.map((r) => [r.code, r.label]));
    const checking = await this.prisma.unscoped().aiReviewJob.count({ where: { claimId: claim.id, status: { not: 'DONE' } } });
    return {
      claimNumber: claim.claimNumber,
      archived: claim.status === 'PAID',
      expiresAt: toJalali(link.expiresAt),
      checking,
      items: refused.map((r) => ({ code: r.code, label: label.get(r.code) ?? r.code, reason: r.reason })),
    };
  }

  async uploadViaLink(token: string, docCode: string, file: Express.Multer.File, ip: string) {
    const { link, claim } = await this.linkClaim(token, ip);
    if (!(await this.rateLimit.hit(`uplink:tok:${link.id}`, 30, 3600))) throw new TooManyRequestsException('تعداد بارگذاری‌ها زیاد است. بعداً تلاش کنید.');
    assertNotPaid(claim);
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (!claimDocOk(file)) throw new BadRequestException(CLAIM_DOC_TYPES_FA);
    const refused = await this.aiQueue.refusedSlots(claim.id);
    if (!refused.some((r) => r.code === docCode)) throw new BadRequestException('این مدرک نیازی به بارگذاری دوباره ندارد');
    const phone = link.phone ? this.crypto.decrypt(link.phone) : null;
    return this.storeDocument(claim, file, docCode, null, async () => phone);
  }

  /** A کارشناس accepts a file the AI refused («پذیرش دستی»): the slot counts as filled again. */
  async acceptAiRefused(claimId: string, docId: string) {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER') throw new ForbiddenException('تنها کارشناس سازمان می‌تواند این کار را انجام دهد');
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim);
    const n = await db.document.updateMany({ where: { id: docId, claimId, aiStatus: 'MISMATCH' }, data: { aiStatus: 'OVERRIDDEN' } });
    if (!n.count) throw new BadRequestException('این مدرک توسط هوش مصنوعی رد نشده است');
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimDocumentAi', targetId: docId, metadata: { claimId, accepted: true } });
    return { ok: true };
  }

  /** «دلایل رد مدارک»: the insurer's checklist first, then any extra reasons of the caller's own org. */
  async rejectReasons(claimId: string): Promise<string[]> {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const ids = [claim.insurerTenantId, getContext()?.tenantId].filter((x): x is string => !!x);
    const orgs = await db.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, rejectReasons: true } });
    const list = ids.flatMap((id) => orgs.find((o) => o.id === id)?.rejectReasons ?? []);
    return [...new Set(list)];
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

  /**
   * All the claim's current documents in one ZIP (the newest version of each required document plus
   * any extra uploads), named «۰۱ - <document title>.<ext>» so they sort like the checklist.
   */
  async documentsZip(claimId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const cl = await this.checklist(claimId);
    const picks: { id: string; title: string }[] = [];
    for (const it of cl.items) if (it.documents[0]) picks.push({ id: it.documents[0].id, title: it.label });
    for (const d of cl.otherDocuments) picks.push({ id: d.id, title: 'سایر مدارک' });
    if (!picks.length) throw new BadRequestException('مدرکی برای دریافت وجود ندارد');
    const docs = await db.document.findMany({ where: { id: { in: picks.map((p) => p.id) } }, select: { id: true, storageKey: true, fileName: true } });
    const byId = new Map(docs.map((d) => [d.id, d]));
    const zip = new JSZip();
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[.\s]+$/, '');
    let n = 0;
    for (const p of picks) {
      const d = byId.get(p.id); if (!d) continue;
      n++;
      const ext = (d.fileName.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
      zip.file(`${String(n).padStart(2, '0')} - ${clean(p.title)}${ext}`, await this.storage.read(d.storageKey));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await this.audit.record({ action: AuditAction.VIEW, tenantId: claim.insurerTenantId, targetType: 'ClaimDocumentsZip', targetId: claimId, metadata: { files: n } });
    return { buffer, fileName: `documents-${claim.policyNumber || claim.claimNumber}.zip`.replace(/[\\/]/g, '-') };
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

  /**
   * «گزارش‌گیری» data: every claim the caller's organization can see, flattened into one row per claim
   * with all its facts (parties, dates, amounts, workflow position, documents) plus every structured
   * field value. The report builder filters, groups and exports these rows in the browser.
   * Dates are Jalali with ASCII digits ("1405/07/21") so they sort and compare as plain text.
   */
  async reportData() {
    const ctx = getContext();
    const db = this.prisma.partyReplica(); // read-only screen → the read-replica when configured
    const claims = await db.claim.findMany({
      where: this.wdScope(ctx?.tenantId),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { steps: { select: { action: true, decidedAt: true } }, deficiencies: { select: { resolvedAt: true } } },
    });
    const ids = claims.map((c) => c.id);
    const insurerIds = [...new Set(claims.map((c) => c.insurerTenantId))];
    const tenantIds = [...new Set(claims.flatMap((c) => [c.insurerTenantId, c.brokerTenantId]).filter((x): x is string => !!x))];
    const companyIds = [...new Set(claims.map((c) => c.policyholderCompanyId).filter((x): x is string => !!x))];
    const branchIds = [...new Set(claims.flatMap((c) => [c.handlingBranchId, c.sellingBranchId]).filter((x): x is string => !!x))];
    const [tenants, companies, branches, values, docs, reqs, defs] = await Promise.all([
      tenantIds.length ? db.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [],
      companyIds.length ? db.policyholderCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
      branchIds.length ? db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : [],
      ids.length ? db.claimFieldValue.findMany({ where: { claimId: { in: ids } }, select: { claimId: true, key: true, value: true } }) : [],
      ids.length ? db.document.findMany({ where: { claimId: { in: ids } }, select: { claimId: true, docCode: true, verificationStatus: true }, orderBy: { createdAt: 'desc' } }) : [],
      db.requiredDocument.findMany({ where: { isActive: true, tenantId: { in: insurerIds } }, select: { tenantId: true, code: true, appliesToTypes: true } }),
      db.claimFieldDef.findMany({ where: { tenantId: { in: insurerIds }, isActive: true }, orderBy: { order: 'asc' }, select: { key: true, label: true, type: true } }),
    ]);
    const tName = new Map(tenants.map((t) => [t.id, t.name]));
    const coName = new Map(companies.map((c) => [c.id, c.name]));
    const brName = new Map(branches.map((b) => [b.id, b.name]));
    // Field columns: every field defined by the insurers involved, in their own order.
    const fieldCols = new Map<string, { label: string; type: string }>();
    for (const d of defs) if (!fieldCols.has(d.key)) fieldCols.set(d.key, { label: d.label, type: d.type });
    const fv = new Map<string, Record<string, string>>();
    for (const v of values) { if (!fv.has(v.claimId)) fv.set(v.claimId, {}); if (v.value != null) fv.get(v.claimId)![v.key] = v.value; }
    const docsBy = new Map<string, { docCode: string | null; verificationStatus: string }[]>();
    for (const d of docs) { if (!d.claimId) continue; if (!docsBy.has(d.claimId)) docsBy.set(d.claimId, []); docsBy.get(d.claimId)!.push(d); }

    const showPii = (ctx?.permissions ?? []).includes(PERMISSIONS.VIEW_PII);
    const ascii = (s: string | null | undefined) => (s ? s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) : null);
    const jd = (d: Date | null | undefined) => (d ? ascii(toJalali(d, false)) : null);
    const num = (d: Prisma.Decimal | null | undefined) => (d != null ? Number(d.toString()) : null);
    const STATUS_FA: Record<string, string> = { DRAFT: 'پیش‌نویس', SUBMITTED: 'ثبت‌شده', UNDER_REVIEW: 'در حال بررسی', RETURNED_INCOMPLETE: 'نقص مدارک', APPROVED: 'تاییدشده', REJECTED: 'ردشده', PAID: 'پرداخت‌شده' };
    const TYPE_FA: Record<string, string> = { DEATH_ILLNESS: 'فوت ناشی از بیماری', DEATH_ACCIDENT: 'فوت ناشی از حادثه', DISABILITY_ACCIDENT: 'نقص عضو / ازکارافتادگی ناشی از حادثه' };
    const now = Date.now();

    const rows = claims.map((c) => {
      const f = fv.get(c.id) ?? {};
      const cd = docsBy.get(c.id) ?? [];
      const required = reqs.filter((r) => r.tenantId === c.insurerTenantId && r.appliesToTypes.includes(c.claimType)).map((r) => r.code);
      const latestByCode = new Map<string, string>();
      for (const d of cd) if (d.docCode && !latestByCode.has(d.docCode)) latestByCode.set(d.docCode, d.verificationStatus);
      const uploaded = required.filter((code) => latestByCode.has(code)).length;
      const approved = required.filter((code) => latestByCode.get(code) === 'VERIFIED').length;
      const paidStep = c.steps.find((s) => s.action === 'MARK_PAID' && s.decidedAt);
      const end = paidStep?.decidedAt ?? (c.status === 'REJECTED' ? c.updatedAt : null);
      const nid = c.deceasedNationalCode ? this.crypto.decrypt(c.deceasedNationalCode) : null;
      const row: Record<string, string | number | null> = {
        policyNumber: c.policyNumber ?? f.policy_number ?? null,
        claimNumber: c.claimNumber,
        status: STATUS_FA[c.status] ?? c.status,
        claimType: TYPE_FA[c.claimType] ?? c.claimType,
        channel: c.channel === 'BROKER' ? 'کارگزاری' : 'مستقیم (شعبه)',
        stage: c.currentStage ? STAGE_FA[c.currentStage as Stage] : 'بسته‌شده',
        direction: !c.currentStage ? '—' : c.flowPurpose === 'PAYMENT' ? 'در مسیر پرداخت' : c.flowDirection === 'DOWN' ? 'عودت برای رفع نقص' : 'در حال بررسی',
        insurer: tName.get(c.insurerTenantId) ?? null,
        broker: c.brokerTenantId ? tName.get(c.brokerTenantId) ?? null : null,
        company: (c.policyholderCompanyId && coName.get(c.policyholderCompanyId)) || f.company_name || c.employerName || null,
        handlingBranch: c.handlingBranchId ? brName.get(c.handlingBranchId) ?? null : null,
        sellingBranch: c.sellingBranchId ? brName.get(c.sellingBranchId) ?? null : null,
        deceasedName: c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : null,
        deceasedNationalCode: nid ? (showPii ? nid : `******${nid.slice(-4)}`) : null,
        birthDate: jd(c.deceasedBirthDate) ?? ascii(f.birth_date),
        age: ageAt(c.deceasedBirthDate, c.eventDate),
        eventDate: jd(c.eventDate) ?? ascii(f.death_date),
        createdAt: jd(c.createdAt),
        noticeDeadline: jd(c.noticeDeadline),
        lateNotice: c.lateNotice ? 'بله' : 'خیر',
        paidDate: jd(paidStep?.decidedAt),
        daysOpen: Math.max(0, Math.round(((end ? end.getTime() : now) - c.createdAt.getTime()) / 86400000)),
        estimatedAmount: num(c.claimedAmount),
        finalizedAmount: num(c.finalizedAmount),
        payableAmount: num(c.finalizedAmount ?? c.claimedAmount),
        lossNoticeNumber: c.lossNoticeNumber ?? null,
        lossNoticeDate: jd(c.lossNoticeDate),
        physicalAt: STAGE_FA[(c.physicalAt as Stage | null) ?? 'POLICYHOLDER'],
        docsRequired: required.length,
        docsUploaded: uploaded,
        docsApproved: approved,
        docsMissing: required.length - uploaded,
        openDeficiencies: c.deficiencies.filter((d) => !d.resolvedAt).length,
        beneficiaryType: f.beneficiary_type ?? c.beneficiaryType ?? null,
        causeOfDeath: f.cause_of_death ?? c.causeOfDeath ?? null,
        imported: c.imported ? 'بله' : 'خیر',
      };
      for (const [key, def] of fieldCols) {
        const v = f[key] ?? null;
        row[`f_${key}`] = v == null ? null
          : def.type === 'AMOUNT' || def.type === 'NUMBER' ? Number(String(ascii(v)).replace(/[^\d.]/g, '')) || null
          : def.type === 'DATE' ? ascii(v) : v;
      }
      return row;
    });
    const columns = [...REPORT_COLUMNS, ...[...fieldCols].map(([key, d]) => ({
      key: `f_${key}`, label: d.label, group: 'فیلدهای پرونده',
      type: d.type === 'AMOUNT' ? 'amount' : d.type === 'NUMBER' ? 'number' : d.type === 'DATE' ? 'date' : 'text',
    }))];
    await this.audit.record({ action: AuditAction.VIEW, tenantId: ctx?.tenantId, targetType: 'ClaimReport', metadata: { rows: rows.length } });
    return { columns, rows, generatedAt: toJalali(new Date()) };
  }

  /** All claims the caller participates in, newest first, flagged if their action is needed. */
  async listMine(q?: string) {
    const ctx = getContext();
    const db = this.db();
    const where: Prisma.ClaimWhereInput =
      ctx?.actorType === 'CUSTOMER'
        ? { ...customerClaimWhere(), deletedAt: null }
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
      ? rows.filter((c) => c.claimNumber.toLowerCase().includes(term.toLowerCase()) || (c.policyNumber ?? '').includes(term) || (this.crypto.decrypt(c.deceasedFullName) ?? '').includes(term))
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
      ? { ...customerClaimWhere(), deletedAt: null, currentStage: 'POLICYHOLDER' }
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
      'stage-broker': { label: 'در دست بررسی کارگزاری', where: up('BROKER'), desk: ['BROKER'] },
      'stage-branch': { label: 'در دست بررسی شعبه', where: up('BRANCH'), desk: ['BRANCH'] },
      'stage-hq': { label: 'در دست بررسی مدیریت ستاد', where: up('HQ'), desk: ['HQ'] },
      'stage-council': { label: 'در دست بررسی شورای فنی', where: up('COUNCIL'), desk: ['COUNCIL'] },
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
    const db = this.prisma.partyReplica(); // read-only screen → the read-replica when configured
    const desk = await this.myDesk();
    const scope = this.wdScope(ctx?.tenantId);
    const perms = new Set(ctx?.permissions ?? []);

    type Tile = { key: string; label: string; count: number; actionable: boolean; mine: number; href?: string };
    const tiles: Tile[] = [];
    if (perms.has(PERMISSIONS.CLAIM_READ)) {
      // Every tile's query runs at once (not one after another) — the Work Desk is the busiest page.
      const seats = desk.insurerAdmin ? INSURER_DESKS : desk.stage ? [desk.stage] : [];
      const [allCount, ...queueTiles] = await Promise.all([
        db.claim.count({ where: scope }),
        ...Object.entries(this.wdQueues()).map(async ([key, q]): Promise<Tile> => {
          const rows = await db.claim.findMany({ where: { AND: [scope, q.where] }, select: { id: true, currentStage: true, flowDirection: true, handlingBranchId: true, brokerTenantId: true, insurerTenantId: true, policyHolderId: true, imported: true } });
          const mine = key === 'physical'
            // requests waiting on my desk: to send/relay (REQUESTED with me) or to confirm receipt (SENT to me)
            ? (desk.stage ? await db.claim.count({ where: { AND: [scope, { physicalRequests: { some: { OR: [{ status: 'REQUESTED', holderStage: desk.stage }, { status: 'SENT', requesterStage: desk.stage }] } } }] } }) : 0)
            : rows.filter((c) => this.holdsDesk(c, desk)).length;
          return { key, label: q.label, count: rows.length, actionable: seats.some((st) => q.desk?.includes(st)), mine };
        }),
      ]);
      tiles.push({ key: 'all', label: 'همه پرونده‌ها', count: allCount as number, actionable: false, mine: 0, href: '/org/claims' }, ...(queueTiles as Tile[]));
    }

    const pendingActions = tiles.reduce((s, t) => s + t.mine, 0);
    const user = ctx?.actorId ? await db.orgUser.findUnique({ where: { id: ctx.actorId }, select: { displayName: true, username: true } }) : null;
    return {
      userName: user?.displayName || user?.username || null,
      role: desk.stage,
      roleLabel: desk.insurerAdmin ? 'مدیر بیمه‌گر (همهٔ مراحل)' : desk.stage ? STAGE_FA[desk.stage] : '—',
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
    const [claims, desk] = await Promise.all([this.prisma.replica().claim.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 }), this.myDesk()]);
    return claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.holdsDesk(c, desk) }));
  }

  /**
   * Advanced search (جستجوی پیشرفته) over the caller's claims. Indexable fields filter in SQL;
   * the deceased's national code matches via its blind index (exact), and name is matched by
   * decrypting within the already-scoped result set. Dates/amounts accept from–to ranges.
   */
  async searchClaims(q: Record<string, string | undefined>) {
    const db = this.prisma.partyReplica(); // read-only screen → the read-replica when configured
    const and: Prisma.ClaimWhereInput[] = [this.wdScope(getContext()?.tenantId)];
    const clean = (s?: string) => (s ?? '').trim();

    // «شماره بیمه‌نامه» (cases are titled by it); the internal CLM number still matches for older links.
    const pn = clean(q.policyNumber) || clean(q.claimNumber);
    if (pn) and.push({ OR: [{ policyNumber: { contains: pn, mode: 'insensitive' } }, { claimNumber: { contains: pn, mode: 'insensitive' } }] });
    // «نوع ذینفع»: the beneficiary-type field, or the imported column on older claims.
    if (clean(q.beneficiaryType)) {
      const bt = clean(q.beneficiaryType);
      const fv = await db.claimFieldValue.findMany({ where: { key: 'beneficiary_type', value: bt }, select: { claimId: true } });
      and.push({ OR: [{ beneficiaryType: bt }, { id: { in: fv.map((v) => v.claimId) } }] });
    }
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
    if (ctx?.actorType === 'CUSTOMER' && customerOwnsClaim(claim)) return;
    if (ctx?.actorType === 'ORG_USER' && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId)) return;
    throw new ForbiddenException('دسترسی به این پرونده ندارید');
  }

  private actor(): string | null {
    return getContext()?.actorId ?? null;
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
      deceasedNationalCode: c.deceasedNationalCode ? this.crypto.decrypt(c.deceasedNationalCode) : null, // lists identify a case by it
      insurerTenantId: c.insurerTenantId,
      brokerTenantId: c.brokerTenantId,
      eventDate: c.eventDate ? toJalali(c.eventDate, false) : null,
      deceasedBirthDate: c.deceasedBirthDate ? toJalali(c.deceasedBirthDate, false) : null,
      deceasedAge: ageAt(c.deceasedBirthDate, c.eventDate),
      policyholderCompanyId: c.policyholderCompanyId ?? null,
      imported: !!c.imported, // brought in from Excel («ورود دسته‌ای») — its filing date is only the import date
      noticeDeadline: c.noticeDeadline ? toJalali(c.noticeDeadline, false) : null,
      lateNotice: c.lateNotice,
      createdAt: c.createdAt ? toJalali(c.createdAt) : null,
      currentStage: c.currentStage ?? null,
      currentStageLabel: c.currentStage ? STAGE_FA[c.currentStage as Stage] : null,
      flowDirection: c.flowDirection ?? null,
      flowPurpose: c.flowPurpose ?? null,
    };
    if (!full) return base;
    const paid = (c.steps ?? []).find((s: any) => s.action === 'MARK_PAID' && s.decidedAt);
    return {
      ...base,
      paidDate: paid ? toJalali(paid.decidedAt, false) : null, // تاریخ پرداخت
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

/** Built-in columns of the report builder (field-value columns are appended per insurer definition). */
const REPORT_COLUMNS: { key: string; label: string; group: string; type: 'text' | 'number' | 'amount' | 'date' }[] = [
  { key: 'policyNumber', label: 'شماره بیمه‌نامه', group: 'پرونده', type: 'text' },
  { key: 'claimNumber', label: 'شمارهٔ داخلی پرونده', group: 'پرونده', type: 'text' },
  { key: 'status', label: 'وضعیت پرونده', group: 'پرونده', type: 'text' },
  { key: 'claimType', label: 'نوع پرونده', group: 'پرونده', type: 'text' },
  { key: 'channel', label: 'کانال', group: 'پرونده', type: 'text' },
  { key: 'imported', label: 'ورود دسته‌ای', group: 'پرونده', type: 'text' },
  { key: 'stage', label: 'مرحلهٔ فعلی', group: 'گردش کار', type: 'text' },
  { key: 'direction', label: 'جهت گردش', group: 'گردش کار', type: 'text' },
  { key: 'lossNoticeNumber', label: 'شمارهٔ اعلام خسارت', group: 'گردش کار', type: 'text' },
  { key: 'lossNoticeDate', label: 'تاریخ اعلام خسارت', group: 'گردش کار', type: 'date' },
  { key: 'insurer', label: 'بیمه‌گر', group: 'طرفین', type: 'text' },
  { key: 'broker', label: 'کارگزاری', group: 'طرفین', type: 'text' },
  { key: 'company', label: 'بیمه‌گزار (شرکت)', group: 'طرفین', type: 'text' },
  { key: 'handlingBranch', label: 'شعبهٔ رسیدگی', group: 'طرفین', type: 'text' },
  { key: 'sellingBranch', label: 'شعبهٔ فروش', group: 'طرفین', type: 'text' },
  { key: 'deceasedName', label: 'نام بیمه‌شده (متوفی)', group: 'بیمه‌شده', type: 'text' },
  { key: 'deceasedNationalCode', label: 'کد ملی متوفی', group: 'بیمه‌شده', type: 'text' },
  { key: 'birthDate', label: 'تاریخ تولد', group: 'بیمه‌شده', type: 'date' },
  { key: 'age', label: 'سن هنگام فوت/حادثه', group: 'بیمه‌شده', type: 'number' },
  { key: 'causeOfDeath', label: 'علت فوت', group: 'بیمه‌شده', type: 'text' },
  { key: 'beneficiaryType', label: 'نوع ذینفع', group: 'بیمه‌شده', type: 'text' },
  { key: 'eventDate', label: 'تاریخ فوت / حادثه', group: 'تاریخ‌ها', type: 'date' },
  { key: 'createdAt', label: 'تاریخ ثبت اولیه', group: 'تاریخ‌ها', type: 'date' },
  { key: 'noticeDeadline', label: 'مهلت اعلام', group: 'تاریخ‌ها', type: 'date' },
  { key: 'lateNotice', label: 'خارج از مهلت', group: 'تاریخ‌ها', type: 'text' },
  { key: 'paidDate', label: 'تاریخ پرداخت', group: 'تاریخ‌ها', type: 'date' },
  { key: 'daysOpen', label: 'مدت رسیدگی (روز)', group: 'تاریخ‌ها', type: 'number' },
  { key: 'estimatedAmount', label: 'مبلغ برآوردی', group: 'مبالغ', type: 'amount' },
  { key: 'finalizedAmount', label: 'مبلغ قطعی', group: 'مبالغ', type: 'amount' },
  { key: 'payableAmount', label: 'مبلغ قابل پرداخت', group: 'مبالغ', type: 'amount' },
  { key: 'physicalAt', label: 'محل اصل مدارک', group: 'مدارک', type: 'text' },
  { key: 'docsRequired', label: 'تعداد مدارک لازم', group: 'مدارک', type: 'number' },
  { key: 'docsUploaded', label: 'مدارک بارگذاری‌شده', group: 'مدارک', type: 'number' },
  { key: 'docsApproved', label: 'مدارک تاییدشده', group: 'مدارک', type: 'number' },
  { key: 'docsMissing', label: 'مدارک ناقص', group: 'مدارک', type: 'number' },
  { key: 'openDeficiencies', label: 'نقص‌های باز', group: 'مدارک', type: 'number' },
];
