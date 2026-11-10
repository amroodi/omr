import { assertNotPaid } from './archived';
import JSZip from 'jszip';
import { randomUUID } from 'crypto';
import { uploadName } from '../../common/validation/upload-name';
import { NoticeRule, NoticeSource, NoticeTarget, SOURCE_FA, TARGET_FA, TARGETS_OF, combine, rulesFor } from './claim-notice';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimStatus, Prisma, SalesChannel } from '@prisma/client';
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
import { activeContracts, fitsLine, policyRows } from '../policyholders/policy-rows';
import { AiReviewQueue } from '../ai-review/ai-review.queue';
import { AiReviewSettings } from '../ai-review/ai-review.settings';
import { sha256 } from '../ai-review/ai-review.queue';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { TooManyRequestsException } from '../inquiry/http-exceptions';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { nextClaimNumber } from './claim-number';
import { isValidIban, isValidNationalCode } from '../../common/validation/field-validation';
import { beneficiaryHiddenDocs } from '../required-docs/defaults';
import { toAsciiDigits } from '../../common/jalali/jalali.util';
import { ModelStore } from '../model-view/model-store.service';
import { CoverageService } from '../model-view/coverage.service';
import { above, actionsFor, causesOf, CaseDetail, detailFor, docApplies, docRequired, normCause, rulesOf, WorkflowModel, Line, lineForm, InsuredRelation, RELATION_FA, DEPENDENT_RELATIONS, ActionKey, below, chainOf, DeskDocFacts, Direction, higher, physicalActionsFor, PhysicalActionKey, physicalBelow, PhysicalState, directTarget, Purpose, ReviewDesk, Stage, STAGE_FA, WorkflowAction, caseTypeOf, dependentsFor, EntryWay, typesFor } from './workflow';
import { allKinds, docKindWhere, isKind, kindLabel, kindsOf } from '../../common/kinds';

const CLAIM_DOC_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // Word
]);
const CLAIM_DOC_EXT = /\.(pdf|jpe?g|png|docx?)$/i;
/** PDF, image or Word. Some browsers send Word files as application/octet-stream, so the extension decides then. */
export const claimDocOk = (f: Express.Multer.File) =>
  CLAIM_DOC_MIME.has(f.mimetype) || (f.mimetype === 'application/octet-stream' && CLAIM_DOC_EXT.test(f.originalname ?? ''));
export const CLAIM_DOC_TYPES_FA = 'فقط PDF، Word (DOC، DOCX)، JPG و PNG مجاز است';
// «فایل ذینفع» (list of heirs/beneficiaries and their shares) may also be an Excel sheet.
export const BENEFICIARY_FILE_CODE = 'BENEFICIARY_FILE';
export const EXCEL_MIME = new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']);

/** A ذینفع / وارث named on the deceased's beneficiary form. */
export interface HeirInput { fullName: string; iban: string; nationalCode?: string; relation?: string; sharePercent?: number }
/** شبا as typed («IR06 2960 …», Persian digits, or the 24 digits alone) → «IR» + 24 digits. */
const normIban = (s: string) => {
  const a = toAsciiDigits(s ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^\d{24}$/.test(a) ? `IR${a}` : a;
};

// The required document «اصل فرم تعیین ذینفع» (required-docs defaults): where the heirs' form is uploaded.
export const BENEFICIARY_FORM_CODE = 'beneficiary_form';

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
  line?: Line; // نوع بیمه‌نامه chosen on the panel-1 login (a picked contract's own kind wins)
  insurerTenantId?: string; // omitted when the بیمه‌گزار files: resolved from its company's insurer contract
  channel: SalesChannel;
  brokerTenantId?: string; // BROKER channel
  sellingBranchId?: string; // DIRECT channel (insurer branch)
  claimType?: string;
  eventDate?: string; // ISO date of the death/accident
  policyNumber?: string;
  /** بیمه‌گزار panel: the company's بیمه‌نامه (PolicyholderContract) the claim is filed under. */
  contractId?: string;
  claimedAmount?: string;
  description?: string; // free-text details (used when بیمه‌گزار files, can't know amount/policy)
  deceasedFullName: string;
  deceasedNationalCode: string;
  /** نوع بیمه‌شده; on SPOUSE / CHILD the deceased* fields are the dependent and these name the main insured. */
  insuredRelation?: InsuredRelation;
  mainInsuredName?: string;
  mainInsuredNationalCode?: string;
  deceasedBirthDate?: string; // ISO
  causeOfDeath?: string; // علت خسارت: the ticked causes and/or typed text
  causeDetail?: string; // «نوع حادثه» when the cause asks for one
  policyHolderId?: string;
  policyholderCompanyId?: string; // بیمه‌گزار company (set automatically when the بیمه‌گزار files)
  onBehalf?: boolean; // کارگزاری files *as* the بیمه‌گزار company (claim:file-on-behalf) — starts at their desk
  /** «اعلام خسارت به»: the desk the new case starts on (must be allowed by the org's rules). */
  startStage?: NoticeTarget;
  /** Start desk شعبه: which branch (optional — any branch of the insurer when empty). */
  branchId?: string;
  /** «ذینفع قانونی» / «وراث قانونی», and the people named on the deceased's form (name + شبا). */
  beneficiaryType?: string;
  heirs?: HeirInput[];
  /** سرمایه فوت / سرمایه حادثه (rials), when the filer knows them — kept as the case's fields. */
  deathCapital?: string;
  accidentCapital?: string;
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

/** «روند سیناد» kartable events, as the evaluation window's history shows them. */
const DESK_EVENT_FA: Record<string, string> = {
  ALLOCATE: 'تخصیص به ارزیاب',
  RELEASE: 'خارج کردن از کارتابل',
  REFER: 'ارجاع به ارزیاب دیگر',
  LATER: 'بعدا بررسی میکنم',
  DOCTOR_REFER: 'ارجاع به پزشک معتمد',
  DOCTOR_EXAM: 'دعوت به معاینه',
  DOCTOR_OPINION: 'اظهار نظر پزشک معتمد',
  FRAUD_CLEAN: 'بررسی کردم، تقلب نیست',
  FRAUD_FLAG: 'تقلب است، عودت شود',
  NOTE: 'یادداشت ارزیاب',
  ASSIGN: 'تخصیص توسط مدیر',
  UNASSIGN: 'برگشت به پرونده‌های تخصیص‌نیافته توسط مدیر',
};

export interface ActInput {
  action: ActionKey;
  note?: string;
  letterId?: string; // a ClaimLetter created beforehand via POST /claims/:id/letters
  deficiencies?: string[]; // RETURN: free-text deficiency lines (rejected documents are added automatically)
  deficiencyDocs?: string[]; // RETURN: required-document codes asked for again
  deficiencyNotes?: string[]; // RETURN: reasons that ask for no upload
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
    private readonly store: ModelStore,
    private readonly coverage: CoverageService,
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
    if (ctx?.assistBy || ctx?.actorType === 'SUPER_ADMIN') return 'مدیر سامانه';
    if (ctx?.actorType === 'CUSTOMER') return 'بیمه‌گزار';
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
  /**
   * Panel 1 of an insurer: its partner کارگزاری‌ها with their بیمه‌گزار companies, its شعبه‌ها, and where
   * Super Admin set its filings to start.
   */
  async insurerEntryOptions() {
    const ctx = getContext();
    const db = this.prisma.unscoped();
    const me = await db.tenant.findUnique({ where: { id: getTenantIdOrThrow() }, select: { id: true, kind: true } });
    if (me?.kind !== 'INSURER') throw new ForbiddenException('فقط بیمه‌گر');
    const partners = await db.brokerInsurerPartnership.findMany({ where: { insurerTenantId: me.id, isActive: true }, select: { brokerTenantId: true, brokerCode: true } });
    const ids = partners.map((p) => p.brokerTenantId);
    const [brokers, companies, branches] = await Promise.all([
      db.tenant.findMany({ where: { id: { in: ids }, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.policyholderCompany.findMany({ where: { tenantId: { in: ids }, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, tenantId: true } }),
      db.branch.findMany({ where: { tenantId: me.id, ...(ctx?.branchScoped && ctx.branchId ? { id: ctx.branchId } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
    ]);
    const model = await this.modelOf(me.id);
    return {
      way: model.entry.way,
      // The filing form's own fields, as set in Model View (the server checks them again).
      form: {
        cause: model.form.cause, birthDate: model.form.birthDate, causeLists: model.form.causeLists, causeNotes: model.form.causeNotes,
        caseTypes: model.form.caseTypes.map((t) => ({ code: t.code, causeGroup: t.causeGroup, causes: causesOf(model, t.code), detail: t.detail ?? null })),
        causeLabels: Object.fromEntries(Object.keys(model.form.lines).map((l) => [l, lineForm(model, l).causeLabel])),
      },
      brokers: brokers.map((b) => ({ ...b, code: partners.find((p) => p.brokerTenantId === b.id)?.brokerCode ?? null, companies: companies.filter((c) => c.tenantId === b.id).map(({ id, name }) => ({ id, name })) })),
      branches,
      // The operator's own شعبه: it handles the cases it files (no «شعبهٔ رسیدگی» to pick then).
      myBranchId: await this.callerBranchId(),
    };
  }

  /** The شعبه of the calling insurer operator (their account's, else their login's), if any. */
  private async callerBranchId(): Promise<string | null> {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER' || !ctx.actorId) return null;
    const u = await this.prisma.unscoped().orgUser.findUnique({ where: { id: ctx.actorId }, select: { branchId: true } });
    return u?.branchId ?? ctx.branchId ?? null;
  }

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

  /**
   * Panel 1 of a brokerage filing for one of its بیمه‌گزاران: that company's بیمه‌نامه‌ها with the insurer's
   * form — the same list the بیمه‌گزار's own «ثبت پرونده خسارت» shows.
   */
  async onBehalfPolicies(companyId: string, line?: Line) {
    const db = this.prisma.unscoped();
    const co = await db.policyholderCompany.findFirst({ where: { id: companyId, tenantId: getTenantIdOrThrow(), isActive: true }, include: { contracts: true } });
    if (!co) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
    const contracts = activeContracts(co.contracts).filter((k) => fitsLine(k, line));
    const ids = [...new Set(contracts.map((k) => k.insurerTenantId))];
    const [insurers, me] = await Promise.all([
      ids.length ? db.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
      db.tenant.findUnique({ where: { id: co.tenantId }, select: { name: true } }),
    ]);
    const rows = policyRows(contracts, new Map(insurers.map((i) => [i.id, i.name])), this.store, await this.policyholders.companyChain(co.id));
    return { brokerName: me?.name ?? '', contracts: rows, selectedId: rows.find((r) => r.inForce)?.id ?? rows[0]?.id ?? null };
  }

  async file(input: FileClaimInput) {
    const db = this.db();
    const ctx = getContext();
    const eventDate = input.eventDate ? new Date(input.eventDate) : null;

    // A بیمه‌گزار doesn't choose the insurer: the brokerage's contract for their company that covered
    // the date of death decides it (and supplies the policy number).
    let companyId = input.policyholderCompanyId ?? null;
    // An insurer's own staff (panel 1) file against their own insurer, for one of its کارگزاران.
    const staffKind = ctx?.actorType === 'ORG_USER' && ctx.tenantId ? (await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { kind: true } }))?.kind ?? null : null;
    if (staffKind === 'INSURER') {
      input.insurerTenantId = ctx!.tenantId;
      if (companyId && (input.channel !== 'BROKER' || !input.brokerTenantId)) throw new BadRequestException('برای بیمه‌گزار، کارگزاری آن را انتخاب کنید');
    }
    if (companyId && ctx?.actorType === 'ORG_USER') {
      // Staff may link only a company their own brokerage serves (an insurer: the chosen کارگزاری's).
      const co = await db.policyholderCompany.findUnique({ where: { id: companyId }, select: { tenantId: true } });
      if (!co || co.tenantId !== (staffKind === 'INSURER' ? input.brokerTenantId : ctx.tenantId)) throw new NotFoundException('شرکت بیمه‌گزار یافت نشد');
      if (input.policyHolderId) {
        const acc = await db.customerAccount.findUnique({ where: { id: input.policyHolderId }, select: { companyId: true } });
        if (acc?.companyId !== companyId) throw new BadRequestException('نماینده انتخاب‌شده متعلق به این شرکت نیست');
      }
    }
    if (ctx?.actorType === 'CUSTOMER' && ctx.customerAgent) {
      // An insurer's نماینده بیمه: a direct sale of that insurer, its معرف the agent's own شعبه. No
      // بیمه‌گزار company or contract; the agent keeps the case (documents first) until «ارسال».
      const acc = await this.prisma.unscoped().customerAccount.findUnique({ where: { id: ctx.actorId }, select: { branchId: true } });
      if (!acc?.branchId) throw new BadRequestException('حساب شما هنوز به شعبه‌ای متصل نشده است؛ با بیمه‌گر تماس بگیرید.');
      companyId = null; input.contractId = undefined; input.policyHolderId = undefined;
      input.insurerTenantId = ctx.tenantId; input.channel = 'DIRECT' as any; input.sellingBranchId = acc.branchId; input.brokerTenantId = undefined;
    } else if (ctx?.actorType === 'CUSTOMER' && ctx.customerBrokerPanel) {
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
    // نوع بیمه‌نامه of the case: the contract's when there is one, else the one chosen on the login, which
    // must be a kind of the catalog that Super Admin opened to the caller's organization.
    if (input.line) {
      if (!isKind(input.line)) throw new BadRequestException('نوع بیمه‌نامه نامعتبر است');
      if (ctx?.tenantId) {
        const org = await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { policyKinds: true } });
        if (!kindsOf(org?.policyKinds).some((k) => k.code === input.line)) throw new BadRequestException('این نوع بیمه‌نامه برای این سازمان فعال نیست');
      }
    }
    let line: Line | null = input.line ?? null;
    if (companyId && input.contractId) {
      // The بیمه‌نامه the بیمه‌گزار picked: it must be theirs, fit the claim type, and cover the date.
      const contract = await this.policyholders.contractForClaim(companyId, input.contractId, eventDate);
      if (input.line && contract.line && contract.line !== input.line) throw new BadRequestException('این بیمه‌نامه از نوع دیگری است');
      line = contract.line ?? line;
      input.insurerTenantId = contract.insurerTenantId;
      input.policyNumber = contract.policyNumber ?? input.policyNumber ?? undefined;
      // Model View decides which نوع پرونده this line takes, for this company, at this insurer.
      if (contract.line && input.claimType && !typesFor(await this.modelOf(contract.insurerTenantId), contract.line, await this.policyholders.companyChain(companyId)).includes(input.claimType)) {
        throw new BadRequestException('این نوع پرونده برای این بیمه‌نامه فعال نیست');
      }
    }
    if (companyId && staffKind === 'INSURER') {
      // The company's contract on that date must be with this insurer; it supplies the policy number.
      const k = await this.policyholders.resolveContract(companyId, eventDate, input.claimType ?? null, input.line ?? null);
      line = k?.line ?? line;
      if (k && k.insurerTenantId !== ctx!.tenantId) throw new BadRequestException('قرارداد این بیمه‌گزار در این تاریخ با بیمه‌گر دیگری است');
      input.policyNumber = input.policyNumber ?? k?.policyNumber ?? undefined;
    }
    if (companyId && !input.insurerTenantId) {
      const contract = await this.policyholders.resolveContract(companyId, eventDate, input.claimType ?? null, input.line ?? null);
      line = contract?.line ?? line;
      if (!contract && input.claimType && await this.policyholders.resolveContract(companyId, eventDate, null, input.line ?? null)) throw new BadRequestException('این نوع پرونده برای این بیمه‌گزار فعال نیست');
      if (!contract) throw new BadRequestException('برای این تاریخ فوت، قرارداد فعالی میان کارگزاری و بیمه‌گر برای شرکت شما ثبت نشده است؛ لطفاً با کارگزاری تماس بگیرید.');
      input.insurerTenantId = contract.insurerTenantId;
      input.policyNumber = input.policyNumber ?? contract.policyNumber ?? undefined;
    }
    if (!input.insurerTenantId) throw new BadRequestException('بیمه‌گر نامعتبر است');
    const insurer = await db.tenant.findUnique({ where: { id: input.insurerTenantId }, select: { id: true, kind: true, noticeDays: true } });
    if (!insurer || insurer.kind !== 'INSURER') throw new BadRequestException('بیمه‌گر نامعتبر است');
    const insurerTenantId = insurer.id;
    // No contract and no chosen kind (e.g. a hand-filed case): the first kind whose نوع پرونده list has it.
    if (!line) { const m = await this.modelOf(insurerTenantId); line = allKinds().map((k) => k.code).find((l) => input.claimType && lineForm(m, l).claimTypes.includes(input.claimType)) ?? null; }
    const form = (await this.modelOf(insurerTenantId)).form;
    // A kind chosen with no company contract behind it (a نماینده بیمه, a hand-filed case): its own نوع پرونده list.
    if (input.line && !companyId && input.claimType && !lineForm(await this.modelOf(insurerTenantId), input.line).claimTypes.includes(input.claimType)) throw new BadRequestException('این نوع پرونده برای این نوع بیمه‌نامه فعال نیست');
    if (input.claimType && !form.caseTypes.some((t) => t.code === input.claimType)) throw new BadRequestException('نوع پرونده نامعتبر است');
    if (form.birthDate === 'required' && !input.deceasedBirthDate) throw new BadRequestException('تاریخ تولد بیمه‌شده الزامی است');
    if (form.cause === 'required' && !input.causeOfDeath?.trim()) throw new BadRequestException('علت را مشخص کنید');
    // A cause picked from the list is kept in the list's own wording.
    const canon = causesOf(await this.modelOf(insurerTenantId), input.claimType).find((o) => normCause(o) === normCause(input.causeOfDeath));
    if (canon) input.causeOfDeath = canon;
    // A cause that asks a second choice («نوع حادثه»): one of its options is required.
    const detail = detailFor(form.caseTypes.find((t) => t.code === input.claimType), input.causeOfDeath);
    const causeDetail = detail ? detail.options.find((o) => normCause(o) === normCause(input.causeDetail)) ?? null : null;
    if (detail && !causeDetail) throw new BadRequestException(`${detail.label} را انتخاب کنید`);

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
    if (!notice.targets.includes(wanted)) {
      throw new BadRequestException(notice.entryWay
        ? `پرونده‌هایی که این بیمه‌گر ثبت می‌کند طبق تنظیم مدیر سامانه از «${notice.targets.map((t) => TARGET_FA[t]).join(' یا ')}» شروع می‌شوند.`
        : 'ارسال پرونده به این مرحله در تنظیمات اعلام خسارت مجاز نیست.');
    }
    if (wanted === 'BROKER' && input.channel !== 'BROKER') throw new BadRequestException('این پرونده کارگزاری ندارد؛ مرحلهٔ دیگری را انتخاب کنید.');
    const firstStage: Stage = wanted as Stage;
    const byPolicyHolder = firstStage === 'POLICYHOLDER';
    let startBranchId = moarefBranchId;
    // An insurer's شعبه files a case: that شعبه handles it (whoever sold the بیمه‌نامه).
    const ownBranch = staffKind === 'INSURER' && firstStage === 'BRANCH' ? await this.callerBranchId() : null;
    if (ownBranch) {
      const b = await db.branch.findFirst({ where: { id: ownBranch, tenantId: insurerTenantId }, select: { id: true } });
      if (b) startBranchId = b.id;
    }
    if (firstStage === 'BRANCH' && !startBranchId && input.branchId) {
      const b = await db.branch.findFirst({ where: { id: input.branchId, tenantId: insurerTenantId }, select: { id: true } });
      if (!b) throw new BadRequestException('شعبه متعلق به بیمه‌گر پرونده نیست');
      startBranchId = b.id;
    }
    if (staffKind === 'INSURER' && firstStage === 'BRANCH' && !startBranchId) throw new BadRequestException('شعبه‌ای را که پرونده به آن می‌رود انتخاب کنید');

    const heirs = this.cleanHeirs(input.heirs);
    const nid = input.deceasedNationalCode;
    // نوع بیمه‌شده: only where Model View asks for it (not the companies of a group without it).
    let relation: string | null = null; let mainName: string | null = null; let mainNid: string | null = null;
    if (input.insuredRelation) {
      if (!dependentsFor(await this.modelOf(insurerTenantId), companyId ? await this.policyholders.companyChain(companyId) : [])) throw new BadRequestException('نوع بیمه‌شده برای این بیمه‌گزار فعال نیست');
      relation = input.insuredRelation;
      if (relation !== 'MAIN') {
        mainName = input.mainInsuredName?.trim() || null;
        mainNid = (input.mainInsuredNationalCode ?? '').trim();
        if (!mainName) throw new BadRequestException('نام بیمه‌شدهٔ اصلی را بنویسید');
        if (!isValidNationalCode(mainNid)) throw new BadRequestException('کد ملی بیمه‌شدهٔ اصلی نامعتبر است');
        if (!isValidNationalCode(nid)) throw new BadRequestException('کد ملی بیمه‌شدهٔ فرعی نامعتبر است');
        if (mainNid === nid) throw new BadRequestException('کد ملی بیمه‌شدهٔ فرعی و اصلی یکسان است');
      }
    }
    // فن‌آوران (when Super Admin has it on for this insurer): is this person — their بیمه‌نامه and its
    // period — defined there? If not, the case isn't filed (or only warned about, as set). The form asks
    // first; this repeats it, since the form's answer can't be trusted. The answer is kept on the case.
    const coverage = nid ? await this.coverage.gate(insurerTenantId, nid, eventDate) : null;
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
        line,
        deceasedBirthDate: input.deceasedBirthDate ? new Date(input.deceasedBirthDate) : null,
        deceasedFullName: this.crypto.encrypt(input.deceasedFullName)!,
        deceasedNationalCode: this.crypto.encrypt(nid)!,
        deceasedNationalCodeHash: this.crypto.blindIndex(nid)!,
        insuredRelation: relation,
        mainInsuredName: mainName ? this.crypto.encrypt(mainName) : null,
        mainInsuredNationalCode: mainNid ? this.crypto.encrypt(mainNid) : null,
        mainInsuredNationalCodeHash: mainNid ? this.crypto.blindIndex(mainNid) : null,
        claimType: input.claimType ?? 'DEATH_ILLNESS',
        eventDate,
        noticeDeadline,
        lateNotice,
        policyNumber: input.policyNumber ?? null,
        claimedAmount: input.claimedAmount ?? '0',
        description: input.description ?? null,
        causeOfDeath: input.causeOfDeath?.trim() || null,
        causeDetail,
        beneficiaryType: input.beneficiaryType || null,
        ...(heirs.length ? { heirs: { create: heirs.map((h, i) => ({ fullName: this.crypto.encrypt(h.fullName)!, iban: this.crypto.encrypt(h.iban)!, nationalCode: h.nationalCode ? this.crypto.encrypt(h.nationalCode) : null, relation: h.relation ?? null, sharePercent: h.sharePercent ?? null, order: i })) } } : {}),
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
    // سرمایه فوت / سرمایه حادثه typed on the form: the case's own fields (as an import fills them).
    const capitals = ([['death_capital', input.deathCapital], ['accident_capital', input.accidentCapital]] as const)
      .map(([key, v]) => [key, String(v ?? '').replace(/[^\d]/g, '')] as const).filter(([, v]) => v && Number(v) > 0);
    if (capitals.length) {
      await db.claimFieldValue.createMany({ data: capitals.map(([key, value]) => ({ claimId: claim.id, key, value, source: 'MANUAL' as any, confirmedAt: new Date() })), skipDuplicates: true });
    }

    await this.audit.record({ action: AuditAction.CLAIM_SUBMIT, tenantId: insurerTenantId, targetType: 'Claim', targetId: claim.id, metadata: { channel: input.channel, moaref: moarefRole, ...(input.onBehalf ? { onBehalf: true, companyId } : {}) } });
    if (byPolicyHolder) {
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد؛ مدارک را بارگذاری و پرونده را ارسال کنید.`);
    } else {
      await this.notifyOrg(firstStage === 'BROKER' ? moarefTenantId : insurerTenantId, 'پرونده خسارت جدید', `پرونده ${claim.claimNumber} برای بررسی به میز کار شما رسید.`, `/org/claims/${claim.id}`);
      await this.notifyPolicyHolder(claim.policyHolderId, 'ثبت پرونده خسارت', `پرونده ${claim.claimNumber} ثبت شد و در حال بررسی است.`);
    }
    // NOT_CHECKED (service down) is filled in by the coverage sweep as soon as the service answers.
    if (coverage) await this.coverage.record(claim.id, coverage);
    return this.present(claim);
  }

  /**
   * «اعلام خسارت» for the caller: may they report a claim, and on which desks may it start? The
   * brokerage's rules cover بیمه‌گزار / نماینده / its operators; the insurer's cover its desks and نمایندگان.
   * With `brokerTenantId` / `insurerTenantId` unknown (before the form is filled) the caller's own org
   * decides, and the insurer is checked again when the claim is filed.
   */
  async noticeOptions(brokerTenantId?: string | null, insurerTenantId?: string | null): Promise<NoticeRule & { source: NoticeSource; labels: Record<string, string>; entryWay?: EntryWay }> {
    const ctx = getContext();
    const db = this.db();
    let source: NoticeSource;
    if (ctx?.actorType === 'CUSTOMER') source = ctx.customerRepresentative ? 'REPRESENTATIVE' : 'POLICYHOLDER';
    else source = ((await this.myDesk()).stage ?? 'BROKER') as NoticeSource;
    // An insurer's نماینده بیمه keeps the case until they send it to their شعبه.
    if (ctx?.actorType === 'CUSTOMER' && ctx.customerAgent) return { enabled: true, targets: ['POLICYHOLDER'], default: 'POLICYHOLDER', source, labels: TARGET_FA };
    // An insurer's own staff: Super Admin's Model View «ورود داده بیمه‌گر» decides where the case starts.
    if (ctx?.actorType === 'ORG_USER' && ctx.tenantId && ['BRANCH', 'HQ', 'COUNCIL'].includes(source)) {
      const way = (await this.modelOf(ctx.tenantId)).entry.way;
      const targets: NoticeTarget[] = way === 'BROKER' ? ['BROKER'] : way === 'BRANCH' ? ['BRANCH'] : way === 'CHANNEL' ? (brokerTenantId ? ['BROKER'] : ['BRANCH']) : ['BROKER', 'BRANCH'];
      return { enabled: true, targets, default: targets[0], source, labels: TARGET_FA, entryWay: way };
    }
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
    if (s === 'BRANCH') return (!claim.handlingBranchId || desk.branchId === claim.handlingBranchId) && !this.allocatedElsewhere(claim, desk);
    return true;
  }

  /** Latest version of each document on the claim (one per required-doc code; each "other" upload on its own). */
  private async latestDocs(claimId: string) {
    const docs = await this.db().document.findMany({ where: { claimId }, orderBy: { createdAt: 'desc' }, select: { id: true, docCode: true, fileName: true, extra: true, reviews: { select: { stage: true, state: true } } } });
    const seen = new Set<string>();
    return docs.filter((d) => {
      if (d.extra) return false; // an extra page («+») goes with its document's decision
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
    const missing = (await this.deficiencySlots(claim.id)).filter((x) => x.open && !x.uploaded).map((x) => x.label);
    return {
      deficiencyMissing: missing,
      count: latest.length,
      allApproved: reviewing && latest.length > 0 && latest.every((d) => stateAt(d) === 'APPROVED'),
      rejectedLabels: reviewing ? latest.filter((d) => stateAt(d) === 'REJECTED').map(label) : [],
      rejectedAnywhere: latest.filter((d) => d.reviews.some((r) => r.state === 'REJECTED')).map(label),
    };
  }

  /**
   * The documents the case's returns asked for: one slot per required document asked again or per
   * operator's own line («نقص دیگر», code `DEF-…`). An open return's slot counts as done only with an
   * upload made after the return.
   */
  private async deficiencySlots(claimId: string) {
    const db = this.db();
    const defs = await db.claimDeficiency.findMany({ where: { claimId, slots: { not: null } }, orderBy: { createdAt: 'asc' } });
    if (!defs.length) return [];
    const codes = defs.flatMap((d) => (safeParse(d.slots ?? "[]") as { code: string }[]).map((x) => x.code));
    const docs = await db.document.findMany({ where: { claimId, docCode: { in: codes } }, select: { docCode: true, createdAt: true } });
    return defs.flatMap((d) => (safeParse(d.slots ?? "[]") as { code: string; label: string }[]).map((x) => ({
      code: x.code, label: x.label, custom: x.code.startsWith('DEF-'), open: !d.resolvedAt, raisedAt: d.createdAt,
      uploaded: docs.some((f) => f.docCode === x.code && (d.resolvedAt ? true : f.createdAt > d.createdAt)),
    })));
  }

  /** What this customer-side login may do at the بیمه‌گزار desk (null for anyone else). */
  private panelRights(model: WorkflowModel) {
    const ctx = getContext();
    if (ctx?.actorType !== 'CUSTOMER') return null;
    return ctx.customerRepresentative ? model.panels.REPRESENTATIVE : model.panels.COMPANY;
  }

  private modelOf(insurerTenantId: string): Promise<WorkflowModel> {
    return this.store.load(insurerTenantId);
  }

  /** Actions the caller may take on the claim right now (empty unless they hold its desk). */
  private async availableActions(claim: any, desk: Desk): Promise<WorkflowAction[]> {
    if (!this.holdsDesk(claim, desk)) return [];
    // Panel 1 doesn't process: it only sends back a case returned to the بیمه‌گزار's desk (رفع نقص).
    if (getContext()?.panelMode === 'ENTRY' && claim.currentStage !== 'POLICYHOLDER') return [];
    const db = this.db();
    const [docs, insurer, branches, physical] = await Promise.all([
      this.deskDocFacts(claim),
      db.tenant.findUnique({ where: { id: claim.insurerTenantId }, select: { hqCeiling: true } }),
      claim.currentStage === 'BROKER'
        ? db.branch.findMany({ where: { tenantId: claim.insurerTenantId }, orderBy: { code: 'asc' }, select: { id: true, name: true, code: true } })
        : Promise.resolve([]),
      this.physicalState(claim),
    ]);
    const model = await this.modelOf(claim.insurerTenantId);
    const submitBlocked = this.panelRights(model)?.submit === false ? 'ارسال پرونده از این پنل غیرفعال است' : undefined;
    return actionsFor({ claim, isAdmin: desk.isAdmin, hqCeiling: insurer?.hqCeiling ?? null, docs, branches, physical, model, submitBlocked });
  }

  /** The claim's place in the chain + what the caller can do, for the panels. */
  private async workflowView(claim: any) {
    const desk = await this.myDesk();
    const s = claim.currentStage as Stage | null;
    const holds = this.holdsDesk(claim, desk);
    const asksNumber = (await this.modelOf(claim.insurerTenantId)).lossNoticeAsksNumber;
    const myOrg = desk.tenantId ? await this.db().tenant.findUnique({ where: { id: desk.tenantId }, select: { chargoonEnabled: true } }) : null;
    return {
      chain: chainOf(claim, await this.modelOf(claim.insurerTenantId)).map((st) => ({ stage: st, label: this.store.labels(claim.insurerTenantId)[st] })),
      currentStage: s,
      currentStageLabel: s ? this.store.labels(claim.insurerTenantId)[s] : null,
      direction: claim.flowDirection ?? null,
      purpose: claim.flowPurpose ?? null,
      returnTargetStage: claim.returnTargetStage ?? null,
      returnTargetLabel: claim.returnTargetStage ? this.store.labels(claim.insurerTenantId)[claim.returnTargetStage as Stage] : null,
      myStage: desk.stage,
      holdsDesk: holds,
      lossNotice: claim.lossNoticeNumber || claim.lossNoticeDate ? { number: claim.lossNoticeNumber ?? null, date: claim.lossNoticeDate ? toJalali(claim.lossNoticeDate, false) : null, at: claim.lossNoticeDate ? toJalali(claim.lossNoticeDate) : null } : null,
      // Recorded once without a number: nothing left to edit. With a number: it can be corrected.
      canRecordLossNotice: false, // «اعلام خسارت» is a document the بیمه‌گزار uploads for now (no شعبه button)
      lossNoticeAsksNumber: asksNumber,
      chargoon: !!myOrg?.chargoonEnabled, // this organization's letters carry «شماره چارگون»
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
        await this.notifyHolder(claim, up!, 'پرونده برای بررسی ارسال شد', `پروندهٔ ${claim.claimNumber} از ${this.store.labels(claim.insurerTenantId)[s]} برای بررسی به شما ارسال شد.`);
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
        await this.notifyHolder(claim, dn!, 'دستور پرداخت', `برای پروندهٔ ${claim.claimNumber} از سوی ${this.store.labels(claim.insurerTenantId)[s]} دستور پرداخت صادر شد.`);
        await this.notifyPolicyHolder(claim.policyHolderId, 'تایید پرونده خسارت', `پروندهٔ ${claim.claimNumber} تایید شد و دستور پرداخت صادر شده است.`);
        break;
      }
      case 'RETURN':
      case 'RETURN_DIRECT': {
        const docs = await this.deskDocFacts(claim);
        // Documents asked for again (from the case's list) and the operator's own lines each become an
        // upload slot: whoever fixes the case uploads there, and it can't move on until they have.
        const reqDocs = input.deficiencyDocs?.length
          ? await db.requiredDocument.findMany({ where: { tenantId: claim.insurerTenantId, code: { in: input.deficiencyDocs } }, select: { code: true, label: true } })
          : [];
        const custom = (input.deficiencies ?? []).map((x) => x.trim().slice(0, 300)).filter(Boolean);
        const slots = [
          ...reqDocs.map((r) => ({ code: r.code, label: r.label })),
          ...custom.map((label) => ({ code: `DEF-${randomUUID().slice(0, 8)}`, label })),
        ];
        const notes = (input.deficiencyNotes ?? []).map((x) => x.trim().slice(0, 300)).filter(Boolean);
        const items = [...docs.rejectedLabels.map((l) => `مدرک ردشده: ${l}`), ...reqDocs.map((r) => `مدرک: ${r.label}`), ...custom, ...notes];
        if (!items.length) throw new BadRequestException('حداقل یک مدرک را انتخاب یا رد کنید، یا یک مورد نقص بنویسید');
        const to: Stage = a.key === 'RETURN_DIRECT' ? directTarget(claim, s) : dn!;
        await db.claimDeficiency.create({ data: { claimId, raisedByTenantId: getContext()?.tenantId ?? null, raisedByStepId: step.id, items: JSON.stringify(items), slots: slots.length ? JSON.stringify(slots) : null } });
        await this.move(claim, step, { ...base, closeState: 'RETURNED_INCOMPLETE', to, direction: 'DOWN', purpose: 'DEFICIENCY', status: ClaimStatus.RETURNED_INCOMPLETE, extra: { returnTargetStage: higher(claim.returnTargetStage as Stage | null, s) } });
        await this.audit.record({ action: AuditAction.CLAIM_RETURN_INCOMPLETE, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { by: s, to, items } });
        await this.notifyHolder(claim, to, 'عودت پرونده برای رفع نقص', `پروندهٔ ${claim.claimNumber} از سوی ${this.store.labels(claim.insurerTenantId)[s]} برای رفع نقص عودت شد: ${items.join('، ')}`);
        break;
      }
      case 'DOWN_FORWARD':
      case 'DOWN_DIRECT': {
        const to: Stage = a.key === 'DOWN_DIRECT' ? directTarget(claim, s) : dn!;
        const purpose = claim.flowPurpose as Purpose;
        await this.move(claim, step, { ...base, closeState: 'FORWARDED', to, direction: 'DOWN', purpose, status: claim.status });
        await this.audit.record({ action: AuditAction.CLAIM_FORWARD, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { from: s, to, purpose } });
        await this.notifyHolder(claim, to, purpose === 'PAYMENT' ? 'دستور پرداخت' : 'عودت پرونده برای رفع نقص', purpose === 'PAYMENT'
          ? `دستور پرداخت پروندهٔ ${claim.claimNumber} برای اقدام به شما ارسال شد.`
          : `پروندهٔ ${claim.claimNumber} برای رفع نقص از ${this.store.labels(claim.insurerTenantId)[s]} به شما ارسال شد.`);
        break;
      }
      case 'FIX_HERE': {
        // The desk fixed the return itself: the نقص is closed and the case is under its review again.
        await db.claimDeficiency.updateMany({ where: { claimId, resolvedAt: null }, data: { resolvedAt: new Date() } });
        await this.move(claim, step, { ...base, closeState: 'FORWARDED', to: s, direction: 'UP', purpose: 'REVIEW', status: ClaimStatus.UNDER_REVIEW });
        await this.audit.record({ action: AuditAction.CLAIM_RECTIFY, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { at: s } });
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
        const holder = physicalBelow(s, claim.brokerTenantId ? 'BROKER' : 'POLICYHOLDER')!;
        const req = await db.claimPhysicalRequest.create({ data: { claimId, requesterStage: s, holderStage: holder, createdById: this.actor() } });
        const ev = await db.claimPhysicalEvent.create({ data: { requestId: req.id, claimId, stage: s, action: 'REQUEST', note, actorId: this.actor() } });
        if (input.letterId) await db.claimLetter.update({ where: { id: input.letterId }, data: { physicalEventId: ev.id } });
        await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimPhysicalRequest', targetId: req.id, metadata: { claimId, requester: s, holder } });
        await this.notifyHolder(claim, holder, 'درخواست اصل مدارک', `${this.store.labels(claim.insurerTenantId)[s]} اصل مدارک پروندهٔ ${claim.claimNumber} را درخواست کرده است.`);
        break;
      }
      case 'REJECT_FINAL': {
        await this.move(claim, step, { ...base, closeState: 'REJECTED', to: null, status: ClaimStatus.REJECTED });
        await this.audit.record({ action: AuditAction.CLAIM_REJECT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { by: s } });
        await this.notifyPolicyHolder(claim.policyHolderId, 'رد پرونده خسارت', `پروندهٔ ${claim.claimNumber} رد شد${note ? `: ${note}` : '.'}`);
        if (claim.brokerTenantId) await this.notifyOrg(claim.brokerTenantId, 'رد پرونده خسارت', `پروندهٔ ${claim.claimNumber} توسط ${this.store.labels(claim.insurerTenantId)[s]} رد شد.`, `/org/claims/${claimId}`);
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
    if (tenantId) await this.notifyOrg(tenantId, title, `${body} (مرحله: ${this.store.labels(claim.insurerTenantId)[to]})`, `/org/claims/${claim.id}`);
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
  async setLossNotice(claimId: string, number?: string, date?: string) {
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
    // This insurer's شعبه just presses «ثبت اعلام خسارت» (no number / date): the time of the click is kept.
    const asksNumber = (await this.modelOf(claim.insurerTenantId)).lossNoticeAsksNumber;
    if (asksNumber && !n) throw new BadRequestException('شمارهٔ اعلام خسارت الزامی است');
    if (!asksNumber && claim.lossNoticeDate) return this.get(claimId); // already recorded
    await db.claim.update({ where: { id: claimId }, data: { lossNoticeNumber: n || null, lossNoticeDate: asksNumber && date ? new Date(date) : new Date(), lossNoticeById: this.actor() } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { lossNoticeNumber: n } });
    return this.get(claimId);
  }

  // ─────────────────────────── Original (physical) documents ───────────────────────────
  private async openPhysicalRequest(claimId: string) {
    return this.db().claimPhysicalRequest.findFirst({ where: { claimId, status: { in: ['REQUESTED', 'SENT'] } }, orderBy: { createdAt: 'desc' } });
  }

  private async physicalState(claim: any): Promise<PhysicalState> {
    const o = await this.openPhysicalRequest(claim.id);
    // On a broker's case the insurer gets the originals from its کارگزاری, never from the بیمه‌گزار directly.
    return { at: (claim.physicalAt as Stage | null) ?? null, base: claim.brokerTenantId ? 'BROKER' : 'POLICYHOLDER', open: o ? { requesterStage: o.requesterStage as Stage, holderStage: o.holderStage as Stage, status: o.status as 'REQUESTED' | 'SENT' } : null };
  }

  /** The desks the caller sits at on this claim, for physical-document actions (an org user acting for بیمه‌گزار counts too). */
  private physicalSeats(claim: any, desk: Desk, state?: PhysicalState["open"]): Stage[] {
    const seats: Stage[] = [];
    // Panel 1 sits only at the بیمه‌گزار's desk; the organization's own desk is panel 2's.
    if (desk.stage && desk.stage !== 'POLICYHOLDER' && getContext()?.panelMode !== 'ENTRY' && this.sitsAt(claim, desk.stage, desk)) seats.push(desk.stage);
    // The insurer's admin may act at any of its own desks (sitsAt): also for the originals — e.g. confirm
    // at شعبه that the originals it asked for arrived, so «ارسال به مدیریت ستاد» opens up.
    if (desk.insurerAdmin && getContext()?.panelMode !== 'ENTRY' && desk.tenantId === claim.insurerTenantId) {
      for (const st of [claim.currentStage, state?.requesterStage, state?.holderStage] as (Stage | null | undefined)[]) {
        if (st && INSURER_DESKS.includes(st) && !seats.includes(st)) seats.push(st);
      }
    }
    if (this.sitsAt(claim, 'POLICYHOLDER', desk)) seats.push('POLICYHOLDER');
    return seats;
  }

  private async physicalView(claim: any, desk: Desk) {
    const db = this.db();
    const state = await this.physicalState(claim);
    const seats = this.physicalSeats(claim, desk, state.open);
    const actions = seats.flatMap((st) => physicalActionsFor(st, state, this.store.labels(claim.insurerTenantId)).map((a) => ({ ...a, seat: st })));
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
      at: state.at ?? state.base ?? 'POLICYHOLDER',
      atLabel: this.store.labels(claim.insurerTenantId)[state.at ?? state.base ?? 'POLICYHOLDER'],
      collected: !!state.at,
      open: o ? { ...o, requesterLabel: this.store.labels(claim.insurerTenantId)[o.requesterStage], holderLabel: this.store.labels(claim.insurerTenantId)[o.holderStage] } : null,
      actions,
      events: events.map((e) => ({
        id: e.id, stage: e.stage, stageLabel: this.store.labels(claim.insurerTenantId)[e.stage as Stage], action: e.action, note: e.note, trackingNo: e.trackingNo,
        at: toJalali(e.createdAt), by: e.actorId ? (uMap.get(e.actorId) ?? null) : null,
        letters: letters.filter((l) => l.physicalEventId === e.id).map((l) => ({ id: l.id, number: l.number, chargoonNo: l.chargoonNo ?? null, subject: l.subject, date: l.letterDate ? toJalali(l.letterDate, false) : null, hasFile: !!l.storageKey, fileName: l.fileName })),
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
    const seat = this.physicalSeats(claim, desk, state.open).find((st) => physicalActionsFor(st, state, this.store.labels(claim.insurerTenantId)).some((a) => a.key === input.action));
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
        const next = physicalBelow(seat, state.base)!;
        await db.claimPhysicalRequest.update({ where: { id: open!.id }, data: { holderStage: next } });
        await event(open!.id, 'RELAY');
        await this.notifyHolder(claim, next, 'درخواست اصل مدارک', `${this.store.labels(claim.insurerTenantId)[open!.requesterStage as Stage]} اصل مدارک پروندهٔ ${claim.claimNumber} را درخواست کرده است (ارسال از طریق ${this.store.labels(claim.insurerTenantId)[seat]}).`);
        break;
      }
      case 'PHYSICAL_SEND': {
        await db.claimPhysicalRequest.update({ where: { id: open!.id }, data: { status: 'SENT', sentAt: new Date() } });
        await event(open!.id, 'SEND');
        await this.notifyHolder(claim, open!.requesterStage as Stage, 'ارسال اصل مدارک', `اصل مدارک پروندهٔ ${claim.claimNumber} توسط ${this.store.labels(claim.insurerTenantId)[seat]} ارسال شد${trackingNo ? ` (کد رهگیری ${trackingNo})` : ''}.`);
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
        await this.notifyHolder(claim, 'BRANCH', 'بازگشت اصل مدارک', `اصل مدارک پروندهٔ ${claim.claimNumber} از ${this.store.labels(claim.insurerTenantId)[seat]} به شعبه بازگردانده شد.`);
        break;
      }
    }
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimPhysical', targetId: claimId, metadata: { action: input.action, seat, trackingNo } });
    await this.notifyAdminsActivity('اصل مدارک', `${await this.actorLabel()} روی پروندهٔ ${claim.claimNumber}: «${physicalActionsFor(seat, state, this.store.labels(claim.insurerTenantId)).find((a) => a.key === input.action)?.label}».`, `/org/claims/${claimId}`);
    return this.get(claimId);
  }

  // ── Letters (مکاتبات) that accompany a hand-off ──
  async createLetter(claimId: string, input: { number?: string; date?: string; subject?: string; chargoonNo?: string }, file?: Express.Multer.File) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
    if (!input.number?.trim() && !input.chargoonNo?.trim() && !file?.buffer?.length) throw new BadRequestException('شمارهٔ نامه یا فایل نامه الزامی است');
    let stored: { storageKey: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
    if (file?.buffer?.length) {
      if (!claimDocOk(file)) throw new BadRequestException(CLAIM_DOC_TYPES_FA);
      stored = { storageKey: await this.storage.save(claim.insurerTenantId, file.buffer), fileName: uploadName(file.originalname), mimeType: file.mimetype, sizeBytes: file.size };
    }
    const ctx = getContext();
    const letter = await db.claimLetter.create({
      data: {
        claimId, number: input.number?.trim() || null, chargoonNo: input.chargoonNo?.trim() || null, letterDate: input.date ? new Date(input.date) : null, subject: input.subject?.trim() || null,
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
    // Only a شعبه sets it (not ستاد / شورای فنی, nor a کارگزاری); Super Admin inside a panel may too.
    if (!getContext()?.assistBy && (await this.myDesk()).stage !== 'BRANCH') throw new ForbiddenException('مبلغ خسارت قطعی را فقط شعبه ثبت می‌کند');
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
    // Level 5 only: Super Admin inside a panel («ورود به پنل»); no organization's own staff (see RolesGuard).
    if (getContext()?.actorType !== 'ORG_USER' || !getContext()?.assistBy) throw new ForbiddenException('حذف پرونده فقط توسط مدیر سامانه (سطح ۵) ممکن است');
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
      // Everyone in the organizations on the case (not only admins): its earlier notices leave the inbox too.
      for (const t of new Set([claim.brokerTenantId, claim.insurerTenantId].filter((x): x is string => !!x))) {
        await this.notifyOrg(t, 'حذف پرونده', `پروندهٔ ${claim.claimNumber} توسط ${await this.actorLabel()} حذف شد (تا ${CLAIM_RETENTION_DAYS} روز قابل بازیابی).`, '/org/claims');
      }
    }
    return { deleted: true, retentionDays: CLAIM_RETENTION_DAYS };
  }

  /** Undo a soft-delete while still within the retention window. Audit-logged. */
  async restore(claimId: string) {
    if (!getContext()?.assistBy) throw new ForbiddenException('بازیابی پرونده فقط توسط مدیر سامانه (سطح ۵) ممکن است');
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
      for (const t of new Set([claim.brokerTenantId, claim.insurerTenantId].filter((x): x is string => !!x))) {
        await this.notifyOrg(t, 'بازیابی پرونده', `پروندهٔ ${claim.claimNumber} توسط ${await this.actorLabel()} از سطل بازیافت بازیابی شد.`, `/org/claims/${claimId}`);
      }
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
    result.filingEdit = await this.filingEditState(claim); // panel 1 only (null elsewhere)
    if (result.story.manual) {
      // Hand-completed: the typed «وضعیت پرونده» and payment date, not the hierarchy's position / hand-off.
      const pay = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key: 'payment_order_date' } }, select: { value: true } });
      result.currentStageLabel = result.story.caseStage;
      result.paidDate = pay?.value ? toPersianDigits(pay.value) : null;
    }
    return result;
  }

  /**
   * Has panel 2 started on the case? Its first document decision, hand-off (any desk past the بیمه‌گزار's
   * acting on it), «ویرایش» save or اعلام خسارت number. From then on panel 1 can't change the filing data.
   */
  private async panel2Started(claim: { id: string; lossNoticeNumber: string | null; lossNoticeDate?: Date | null }): Promise<boolean> {
    if (claim.lossNoticeNumber || claim.lossNoticeDate) return true;
    const db = this.db();
    const [step, review, log] = await Promise.all([
      db.claimStep.findFirst({ where: { claimId: claim.id, NOT: { stage: 'POLICYHOLDER' }, state: { not: 'PENDING' } }, select: { id: true } }),
      db.documentReview.findFirst({ where: { document: { claimId: claim.id }, state: { not: 'PENDING' } }, select: { id: true } }),
      db.claimFieldLog.findFirst({ where: { claimId: claim.id }, select: { id: true } }),
    ]);
    return !!(step || review || log);
  }

  /** Panel 1 (the بیمه‌گزار / نماینده, or the organization's own filing staff): may it still correct this case? */
  private async filingEditState(claim: any): Promise<{ editable: boolean; reason: string | null } | null> {
    const ctx = getContext();
    const perms = ctx?.permissions ?? [];
    const panel1 = ctx?.actorType === 'CUSTOMER'
      ? customerOwnsClaim(claim)
      : ctx?.actorType === 'ORG_USER' && ctx.panelMode === 'ENTRY' && (perms.includes(PERMISSIONS.CLAIM_FILE) || perms.includes(PERMISSIONS.CLAIM_FILE_ON_BEHALF))
        && (ctx.tenantId === claim.insurerTenantId || ctx.tenantId === claim.brokerTenantId);
    if (!panel1) return null;
    if (claim.imported || ['APPROVED', 'REJECTED', 'PAID'].includes(claim.status)) return { editable: false, reason: 'پرونده بسته شده است.' };
    if (await this.panel2Started(claim)) return { editable: false, reason: 'بررسی پرونده آغاز شده است؛ برای اصلاح مشخصات با کارشناس تماس بگیرید.' };
    return { editable: true, reason: null };
  }

  /** Panel 1 corrects what it filed (name, کد ملی, dates, cause, description) until panel 2 starts on it. */
  async editFiling(claimId: string, input: { deceasedFullName?: string; deceasedNationalCode?: string; eventDate?: string; deceasedBirthDate?: string; causeOfDeath?: string; causeDetail?: string; description?: string }) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const state = await this.filingEditState(claim);
    if (!state?.editable) throw new ForbiddenException(state?.reason ?? 'اجازهٔ ویرایش این پرونده را ندارید');
    const data: Prisma.ClaimUpdateInput = {};
    const changed: string[] = [];
    if (input.deceasedFullName !== undefined) { data.deceasedFullName = this.crypto.encrypt(input.deceasedFullName.trim())!; changed.push('name'); }
    if (input.deceasedNationalCode !== undefined) {
      const nid = input.deceasedNationalCode.trim();
      data.deceasedNationalCode = this.crypto.encrypt(nid)!;
      data.deceasedNationalCodeHash = this.crypto.blindIndex(nid)!;
      changed.push('nationalCode');
    }
    const birth = input.deceasedBirthDate === undefined ? claim.deceasedBirthDate : input.deceasedBirthDate ? new Date(input.deceasedBirthDate) : null;
    if (input.deceasedBirthDate !== undefined) {
      if (birth && isNaN(birth.getTime())) throw new BadRequestException('تاریخ تولد نامعتبر است');
      data.deceasedBirthDate = birth; changed.push('birthDate');
    }
    let event = claim.eventDate;
    if (input.eventDate !== undefined) {
      event = new Date(input.eventDate);
      // The date must stay inside this case's بیمه‌نامه (another policy year means another case).
      if (claim.policyholderCompanyId && claim.policyNumber) {
        const k = await db.policyholderContract.findFirst({ where: { companyId: claim.policyholderCompanyId, insurerTenantId: claim.insurerTenantId, policyNumber: claim.policyNumber }, select: { startDate: true, endDate: true } });
        if (k && ((k.startDate && event < k.startDate) || (k.endDate && event > k.endDate))) {
          throw new BadRequestException(`تاریخ وقوع در دورهٔ بیمه‌نامهٔ این پرونده (${k.startDate ? toJalali(k.startDate, false) : '…'} تا ${k.endDate ? toJalali(k.endDate, false) : '…'}) نیست.`);
        }
      }
      const insurer = await db.tenant.findUnique({ where: { id: claim.insurerTenantId }, select: { noticeDays: true } });
      const deadline = new Date(event.getTime() + (insurer?.noticeDays ?? 30) * 86400000);
      Object.assign(data, { eventDate: event, noticeDeadline: deadline, lateNotice: claim.createdAt > deadline });
      changed.push('eventDate');
    }
    if (birth && event && birth > event) throw new BadRequestException('تاریخ تولد بعد از تاریخ وقوع است');
    if (input.causeOfDeath !== undefined) { data.causeOfDeath = input.causeOfDeath.trim() || null; changed.push('cause'); }
    if (input.causeOfDeath !== undefined || input.causeDetail !== undefined) {
      const cause = input.causeOfDeath !== undefined ? input.causeOfDeath.trim() || null : claim.causeOfDeath;
      const det = detailFor(caseTypeOf(await this.modelOf(claim.insurerTenantId), claim.claimType), cause);
      const want = input.causeDetail !== undefined ? input.causeDetail : claim.causeDetail;
      const cd = det ? det.options.find((o) => normCause(o) === normCause(want)) ?? null : null;
      if (det && !cd) throw new BadRequestException(`${det.label} را انتخاب کنید`);
      if (cd !== claim.causeDetail) { data.causeDetail = cd; changed.push('causeDetail'); }
    }
    if (input.description !== undefined) { data.description = input.description.trim() || null; changed.push('description'); }
    // A new کد ملی or date: the insurer's system (فن‌آوران) is asked again.
    if (claim.coverageStatus && (changed.includes('nationalCode') || changed.includes('eventDate'))) data.coverageStatus = 'NOT_CHECKED';
    if (!changed.length) return this.get(claimId);
    await db.claim.update({ where: { id: claimId }, data });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { filing: changed } });
    return this.get(claimId);
  }

  /**
   * A کارگزاری's own panel-1 list (Tenant.entryRequiredDocs): when its panel 1 looks at its case, only those
   * documents are required and the rest are optional. null = the insurer's rules (anyone else, no list, or a
   * checklist the list says nothing about, e.g. an accident case for a death-only list).
   */
  private async entryRequired(claim: { brokerTenantId: string | null }, codes: string[]): Promise<{ required: Set<string>; accident: Set<string> } | null> {
    const ctx = getContext();
    const panel1 = ctx?.actorType === 'CUSTOMER' || (ctx?.actorType === 'ORG_USER' && ctx.panelMode === 'ENTRY');
    if (!panel1 || !ctx?.tenantId || ctx.tenantId !== claim.brokerTenantId) return null;
    const t = await this.db().tenant.findUnique({ where: { id: ctx.tenantId }, select: { entryRequiredDocs: true, entryAccidentDocs: true } });
    const required = new Set(t?.entryRequiredDocs ?? []);
    const accident = new Set((t?.entryAccidentDocs ?? []).filter((c) => !required.has(c)));
    return codes.some((c) => required.has(c) || accident.has(c)) ? { required, accident } : null;
  }

  /** A traffic accident: an accident نوع پرونده, or a «علت خسارت» that names a crash. */
  private isCrash(claim: { claimType: string | null; causeOfDeath?: string | null }): boolean {
    return /ACCIDENT/.test(claim.claimType ?? '') || /تصادف|سانحه|رانندگی|واژگونی|برخورد/.test(claim.causeOfDeath ?? '');
  }

  /** Trim names, normalise each شبا and refuse an invalid one (named, so the filer knows which row). */
  private cleanHeirs(list?: HeirInput[]): HeirInput[] {
    const rows = (list ?? []).filter((h) => h.fullName?.trim() || h.iban?.trim()).map((h) => {
      const fullName = (h.fullName ?? '').trim();
      const iban = normIban(h.iban);
      if (fullName.length < 2) throw new BadRequestException('نام هر ذینفع / وارث را بنویسید.');
      if (!isValidIban(iban)) throw new BadRequestException(`شماره شبای «${fullName}» نامعتبر است (IR و ۲۴ رقم).`);
      const nationalCode = h.nationalCode?.trim() || undefined;
      if (nationalCode && !isValidNationalCode(nationalCode)) throw new BadRequestException(`کد ملی «${fullName}» نامعتبر است.`);
      const sharePercent = h.sharePercent ?? undefined;
      if (sharePercent != null && (sharePercent < 0 || sharePercent > 100)) throw new BadRequestException(`سهم «${fullName}» باید بین ۰ تا ۱۰۰ درصد باشد.`);
      return { fullName, iban, nationalCode, relation: h.relation?.trim() || undefined, sharePercent };
    });
    const total = rows.reduce((t, h) => t + (h.sharePercent ?? 0), 0);
    if (total > 100.001) throw new BadRequestException('جمع سهم ذینفعان بیش از ۱۰۰ درصد است.');
    return rows;
  }

  /** Who may change the heirs: staff who process cases (and see PII), or the بیمه‌گزار while it's on their desk. */
  private canEditHeirs(claim: { status: string; currentStage: string | null }) {
    const ctx = getContext();
    if (claim.status === 'PAID') return false;
    if (ctx?.actorType === 'CUSTOMER') return claim.currentStage === 'POLICYHOLDER';
    if (ctx?.panelMode === 'ENTRY') return claim.currentStage === 'POLICYHOLDER'; // panel 1: like the بیمه‌گزار
    const perms = ctx?.permissions ?? [];
    return ctx?.actorType === 'SUPER_ADMIN' || (perms.includes(PERMISSIONS.CLAIM_PROCESS) && perms.includes(PERMISSIONS.VIEW_PII));
  }

  /** «ذینفع / وراث قانونی»: the kind, each person's name and شبا (masked for staff without view:pii). */
  async heirs(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId }, include: { heirs: { orderBy: { order: 'asc' } } } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const ctx = getContext();
    const full = ctx?.actorType !== 'ORG_USER' || (ctx.permissions ?? []).includes(PERMISSIONS.VIEW_PII);
    // The deceased's form itself: the latest upload in the checklist's «فرم تعیین ذینفع» slot.
    const form = await this.db().document.findFirst({ where: { claimId, docCode: BENEFICIARY_FORM_CODE }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true } });
    return {
      beneficiaryType: claim.beneficiaryType,
      canEdit: this.canEditHeirs(claim),
      form,
      heirs: claim.heirs.map((h) => {
        const iban = this.crypto.decrypt(h.iban) ?? '';
        const nationalCode = h.nationalCode ? this.crypto.decrypt(h.nationalCode) ?? '' : '';
        return { id: h.id, sharePercent: h.sharePercent != null ? Number(h.sharePercent) : null, relation: h.relation ?? '', nationalCode: full ? nationalCode : nationalCode ? `••••••${nationalCode.slice(-4)}` : '', fullName: this.crypto.decrypt(h.fullName) ?? '', iban: full ? iban : `IR••••••••••••••••••••${iban.slice(-4)}` };
      }),
    };
  }

  /** Replace the heirs list (and the kind) of a case. */
  async setHeirs(claimId: string, input: { beneficiaryType?: string; heirs: HeirInput[] }) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    assertNotPaid(claim); // archived once paid
    if (!this.canEditHeirs(claim)) throw new ForbiddenException('اجازهٔ ویرایش ذینفعان این پرونده را ندارید');
    const heirs = this.cleanHeirs(input.heirs);
    await db.$transaction([
      db.claimHeir.deleteMany({ where: { claimId } }),
      ...(heirs.length ? [db.claimHeir.createMany({ data: heirs.map((h, i) => ({ claimId, fullName: this.crypto.encrypt(h.fullName)!, iban: this.crypto.encrypt(h.iban)!, nationalCode: h.nationalCode ? this.crypto.encrypt(h.nationalCode) : null, relation: h.relation ?? null, sharePercent: h.sharePercent ?? null, order: i })) })] : []),
      db.claim.update({ where: { id: claimId }, data: { beneficiaryType: input.beneficiaryType || null } }),
    ]);
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'Claim', targetId: claimId, metadata: { heirs: heirs.length, beneficiaryType: input.beneficiaryType ?? null } });
    return this.heirs(claimId);
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

  /** Required-document checklist for a claim: its نوع پرونده, «علت» and «نوع حادثه» decide what is listed and required. */
  async checklist(claimId: string) {
    const db = this.db();
    const claim = await db.claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);

    const allReqs = await db.requiredDocument.findMany({
      where: { tenantId: claim.insurerTenantId, isActive: true, code: { notIn: beneficiaryHiddenDocs(claim.beneficiaryType) }, ...docKindWhere(claim.line) },
      orderBy: { order: 'asc' },
    });
    const reqs = allReqs.filter((r) => docApplies(r, claim));
    const docs = await db.document.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, docCode: true, fileName: true, extra: true, verificationStatus: true, verificationNote: true, createdAt: true, uploadedBy: true, aiStatus: true, aiReason: true, aiDetectedCode: true },
    });
    // A document no longer listed for this case (its list changed) keeps its slot while it has files.
    const kept = allReqs.filter((r) => !reqs.includes(r) && docs.some((d) => d.docCode === r.code));
    const byCode = new Map<string, typeof docs>();
    const extrasBy = new Map<string, typeof docs>(); // «+»: more pages of the slot's document
    for (const d of docs) {
      const k = d.docCode ?? '_other';
      const into = d.extra && d.docCode ? extrasBy : byCode;
      if (!into.has(k)) into.set(k, []);
      into.get(k)!.push(d);
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
    const labelOf = new Map([...reqs, ...kept].map((r) => [r.code, r.label]));
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
    const entryList = await this.entryRequired(claim, reqs.map((r) => r.code));
    const items = [...reqs, ...kept].map((r) => {
      const group = byCode.get(r.code) ?? [];
      const latest = group[0];
      return {
        code: r.code,
        label: r.label,
        appliesToTypes: r.appliesToTypes,
        required: kept.includes(r) ? false : entryList ? entryList.required.has(r.code) || (entryList.accident.has(r.code) && this.isCrash(claim)) : docRequired(r, claim),
        accidentOnly: !!entryList?.accident.has(r.code), // «در صورت وقوع سانحه تصادف» (not greyed)
        uploaded: !!latest && latest.aiStatus !== 'MISMATCH', // a refused newest file leaves the slot to fix
        aiRefused: latest?.aiStatus === 'MISMATCH',
        latestStatus: latest?.verificationStatus ?? null,
        documents: present(group),
        extras: present(extrasBy.get(r.code) ?? []),
      };
    });
    // نقص مدارک: a required document asked for again is due again; an operator's own line is a slot of its own.
    const defSlots = await this.deficiencySlots(claimId);
    for (const it of items as any[]) {
      const slot = defSlots.find((x) => x.code === it.code && x.open);
      if (slot) Object.assign(it, { required: true, uploaded: slot.uploaded, deficiency: { open: true, raisedAt: toJalali(slot.raisedAt) } });
    }
    const seenDef = new Set<string>();
    for (const x of defSlots.filter((y) => y.custom)) {
      if (seenDef.has(x.code)) continue;
      seenDef.add(x.code);
      const group = byCode.get(x.code) ?? [];
      (items as any[]).push({
        code: x.code, label: x.label, appliesToTypes: [], required: x.open, accidentOnly: false,
        uploaded: x.uploaded, aiRefused: false, latestStatus: group[0]?.verificationStatus ?? null, documents: present(group), extras: present(extrasBy.get(x.code) ?? []),
        deficiency: { open: x.open, raisedAt: toJalali(x.raisedAt), custom: true },
      });
    }
    // what is asked in an open نقص first, then the insurer's own order
    items.sort((x: any, y: any) => Number(!!y.deficiency?.open) - Number(!!x.deficiency?.open));
    const reqCodes = new Set([...reqs.map((r) => r.code), ...kept.map((r) => r.code), ...seenDef]);
    return {
      claimType: claim.claimType,
      archived: claim.status === 'PAID', // a paid case takes no more uploads or reviews
      complete: items.length > 0 && items.every((i) => i.uploaded || !i.required),
      entryList: !!entryList, // the کارگزاری's own panel-1 list decides what is required (the rest show greyed)
      note: (await this.modelOf(claim.insurerTenantId)).form.docsNote,
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
    if (!(getContext()?.permissions ?? []).includes(PERMISSIONS.DOC_VERIFY) || getContext()?.panelMode === 'ENTRY') return false;
    return claim.currentStage === stage && claim.flowDirection === 'UP' && (desk.stage === stage || !!desk.insurerAdmin) && this.holdsDesk(claim, desk);
  }

  /** Review columns shown per document: the desks on this claim's chain (شورای فنی once it was referred). */
  private async reviewDesks(claim: any): Promise<ReviewDesk[]> {
    const referred = claim.currentStage === 'COUNCIL' || (await this.db().claimStep.count({ where: { claimId: claim.id, stage: 'COUNCIL' } })) > 0;
    const model = await this.modelOf(claim.insurerTenantId);
    return chainOf(claim, model).filter((s): s is ReviewDesk => s !== 'POLICYHOLDER' && model.stages[s].reviewDocs && (s !== 'COUNCIL' || referred));
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
      const who = (l.actorId && name.get(l.actorId)) || (l.actorType === 'SUPER_ADMIN' ? 'مدیر سامانه' : l.actorType === 'CUSTOMER' || l.actorType === 'INSURED' ? 'بیمه‌گزار' : 'کاربر سامانه');
      let text: string;
      if (l.targetType === 'ClaimDocumentReview') {
        const stage = this.store.labels(claim.insurerTenantId)[m.stage as Stage] ?? m.stage ?? '—';
        text = `${who} در مرحلهٔ «${stage}» این مدرک را ${STATE_VERB[m.state] ?? m.state}${m.note ? ` — توضیح: «${m.note}»` : ''}.`;
      } else if (l.action === 'UPLOAD') {
        text = `${who} این فایل را بارگذاری کرد.`;
      } else if (m.verify) {
        text = `${who} وضعیت کلی مدرک را «${DOC_STATUS_LABELS[m.verify] ?? m.verify}» ثبت کرد${m.note ? ` — توضیح: «${m.note}»` : ''}.`;
      } else {
        text = `${who} این مدرک را ویرایش کرد.`;
      }
      return { at: toJalali(l.createdAt), stage: m.stage ?? null, stageLabel: m.stage ? this.store.labels(claim.insurerTenantId)[m.stage as Stage] ?? null : null, state: m.state ?? null, by: who, text };
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
    await this.notifyAdminsActivity('بررسی مدرک (مرحله‌ای)', `${await this.actorLabel()} در مرحلهٔ «${this.store.labels(claim.insurerTenantId)[stage]}» یکی از مدارک پروندهٔ ${claim.claimNumber} را «${stateFa}» کرد.`, `/org/claims/${claimId}`);
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
  async uploadDocument(claimId: string, file: Express.Multer.File, docCode: string, extra = false) {
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
    if (this.panelRights(await this.modelOf(claim.insurerTenantId))?.upload === false) throw new ForbiddenException('بارگذاری مدارک از این پنل غیرفعال است');
    const ctx = getContext();
    if (ctx?.actorType === 'ORG_USER' && !(ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_FILE)) {
      // An assessor without claim:file uploads only while the case is on their own desk.
      if (!(ctx.permissions ?? []).includes(PERMISSIONS.CLAIM_PROCESS) || !this.holdsDesk(claim, await this.myDesk())) throw new ForbiddenException('بارگذاری مدرک فقط وقتی پرونده نزد شماست ممکن است');
    }
    return this.storeDocument(claim, file, docCode, getContext()?.actorId ?? null, () => this.uploaderPhone(claim), extra && !!docCode?.trim());
  }

  /**
   * Save a claim document and, when «بررسی هوشمند مدارک» is on for the case, queue the AI check
   * (the uploader carries on; the verdict comes by SMS). Shared by the panels and the SMS re-upload link.
   */
  async storeDocument(
    claim: { id: string; insurerTenantId: string; brokerTenantId: string | null },
    file: Express.Multer.File, docCode: string, uploadedBy: string | null, notifyPhone: () => Promise<string | null>, extra = false,
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
        extra,
      },
      select: { id: true, docCode: true, fileName: true },
    });
    await this.audit.record({ action: AuditAction.UPLOAD, tenantId: claim.insurerTenantId, targetType: 'ClaimDocument', targetId: doc.id, metadata: { claimId, docCode, ...(extra ? { extra } : {}) } });
    let aiQueued = false;
    // An extra page isn't checked on its own (it may be a paper that only goes with the document).
    if (!extra && docCode.trim() !== BENEFICIARY_FILE_CODE && (await this.aiSettings.enabledForClaim(claim))) {
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

  /** A case the caller is a party to (for the پنل بیمه‌شده invitations). Only the بیمه‌گزار side invites. */
  async claimForParty(claimId: string) {
    if (getContext()?.actorType !== 'CUSTOMER') throw new ForbiddenException('دسترسی ندارید');
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    return claim;
  }

  /** A file from the پنل بیمه‌شده: the caller has already checked the access; the file rules are the panels'. */
  async storeInsuredDocument(claim: { id: string; insurerTenantId: string; brokerTenantId: string | null }, file: Express.Multer.File, docCode: string, phone: string | null) {
    if (!claimDocOk(file)) throw new BadRequestException(CLAIM_DOC_TYPES_FA);
    return this.storeDocument(claim, file, docCode, null, async () => phone);
  }

  /** The insurer behind a بیمه‌نامه of the caller's own company (or brokerage, for the «broker» login). */
  async insurerOfContract(contractId: string): Promise<string> {
    const ctx = getContext();
    // Org staff (a brokerage's panel 1): any company of their own brokerage.
    const k = await this.prisma.unscoped().policyholderContract.findFirst({ where: { id: contractId, isActive: true, company: ctx?.customerBrokerPanel || ctx?.actorType === 'ORG_USER' ? { tenantId: ctx.tenantId } : { id: ctx?.customerCompanyId ?? (await this.prisma.unscoped().customerAccount.findUnique({ where: { id: ctx?.actorId ?? '' }, select: { companyId: true } }))?.companyId ?? '' } }, select: { insurerTenantId: true } });
    if (!k) throw new NotFoundException('بیمه‌نامه یافت نشد');
    if (!(await this.rateLimit.hit(`coverage:${ctx?.actorId ?? 'x'}`, 30, 3600))) throw new TooManyRequestsException('تعداد استعلام‌ها زیاد است. بعداً تلاش کنید');
    return k.insurerTenantId;
  }

  /** An insurer's نماینده بیمه files without a company contract: their own insurer answers the check. */
  async insurerOfAgent(): Promise<string> {
    const ctx = getContext();
    if (!ctx?.customerAgent || !ctx.tenantId) throw new BadRequestException('بیمه‌نامه را انتخاب کنید');
    if (!(await this.rateLimit.hit(`coverage:${ctx.actorId ?? 'x'}`, 30, 3600))) throw new TooManyRequestsException('تعداد استعلام‌ها زیاد است. بعداً تلاش کنید');
    return ctx.tenantId;
  }

  /**
   * The insurer whose فن‌آوران connection answers the panel-1 staff form's coverage check: the chosen
   * بیمه‌نامه's insurer; else the insurer picked on the form (the staff's own insurer, or one their
   * brokerage cooperates with); else the picked company's بیمه‌نامه in force on the event date.
   */
  async insurerForCoverage(input: { contractId?: string; insurerTenantId?: string; companyId?: string; eventDate?: string }): Promise<string> {
    if (input.contractId) return this.insurerOfContract(input.contractId);
    const ctx = getContext();
    const db = this.prisma.unscoped();
    const own = await db.tenant.findUnique({ where: { id: ctx?.tenantId ?? '' }, select: { id: true, kind: true } });
    if (!own) throw new ForbiddenException('دسترسی ندارید');
    let insurerId: string | null = null;
    if (input.insurerTenantId) {
      const allowed = own.kind === 'INSURER'
        ? input.insurerTenantId === own.id
        : !!(await db.brokerInsurerPartnership.findFirst({ where: { brokerTenantId: own.id, insurerTenantId: input.insurerTenantId, isActive: true }, select: { id: true } }));
      if (!allowed) throw new BadRequestException('بیمه‌گر نامعتبر است');
      insurerId = input.insurerTenantId;
    } else if (own.kind === 'INSURER') {
      insurerId = own.id;
    } else if (input.companyId) {
      const co = await db.policyholderCompany.findFirst({ where: { id: input.companyId, tenantId: own.id }, select: { id: true } });
      if (!co) throw new NotFoundException('بیمه‌گزار یافت نشد');
      insurerId = (await this.policyholders.resolveContract(co.id, input.eventDate ? new Date(input.eventDate) : new Date()))?.insurerTenantId ?? null;
    }
    if (!insurerId) throw new BadRequestException('بیمه‌گر پرونده هنوز مشخص نیست');
    if (!(await this.rateLimit.hit(`coverage:${ctx?.actorId ?? 'x'}`, 30, 3600))) throw new TooManyRequestsException('تعداد استعلام‌ها زیاد است. بعداً تلاش کنید');
    return insurerId;
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
      db.requiredDocument.findMany({ where: { isActive: true, tenantId: { in: insurerIds } }, select: { tenantId: true, code: true, appliesToTypes: true, requiredTypes: true, causes: true, requiredDetails: true } }),
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
    const now = Date.now();

    const rows = claims.map((c) => {
      const f = fv.get(c.id) ?? {};
      const cd = docsBy.get(c.id) ?? [];
      const hidden = beneficiaryHiddenDocs(c.beneficiaryType);
      const required = reqs.filter((r) => r.tenantId === c.insurerTenantId && docApplies(r, c) && docRequired(r, c) && !hidden.includes(r.code)).map((r) => r.code);
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
        claimType: caseTypeOf(this.store.get(c.insurerTenantId), c.claimType)?.label ?? c.claimType,
        channel: c.channel === 'BROKER' ? 'کارگزاری' : 'مستقیم (شعبه)',
        stage: c.currentStage ? this.store.labels(c.insurerTenantId)[c.currentStage as Stage] : 'بسته‌شده',
        direction: !c.currentStage ? '—' : c.flowPurpose === 'PAYMENT' ? 'در مسیر پرداخت' : c.flowDirection === 'DOWN' ? 'عودت برای رفع نقص' : 'در حال بررسی',
        insurer: tName.get(c.insurerTenantId) ?? null,
        broker: c.brokerTenantId ? tName.get(c.brokerTenantId) ?? null : null,
        company: (c.policyholderCompanyId && coName.get(c.policyholderCompanyId)) || f.company_name || c.employerName || null,
        handlingBranch: c.handlingBranchId ? brName.get(c.handlingBranchId) ?? null : null,
        sellingBranch: c.sellingBranchId ? brName.get(c.sellingBranchId) ?? null : null,
        deceasedName: c.deceasedFullName ? this.crypto.decrypt(c.deceasedFullName) : null,
        deceasedNationalCode: nid ? (showPii ? nid : `******${nid.slice(-4)}`) : null,
        insuredRelation: RELATION_FA[(c.insuredRelation ?? 'MAIN') as InsuredRelation] ?? 'اصلی',
        mainInsuredName: c.mainInsuredName ? this.crypto.decrypt(c.mainInsuredName) : null,
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
        physicalAt: this.store.labels(c.insurerTenantId)[(c.physicalAt as Stage | null) ?? 'POLICYHOLDER'],
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
  async listMine(q?: string, line?: Line) {
    const ctx = getContext();
    const db = this.db();
    // A بیمه‌گزار's own cases, or staff's desk; nobody else (the inquiry's token reads one case elsewhere).
    if (ctx?.actorType !== 'CUSTOMER' && ctx?.actorType !== 'ORG_USER') throw new ForbiddenException('دسترسی ندارید');
    const where: Prisma.ClaimWhereInput =
      ctx?.actorType === 'CUSTOMER'
        ? { ...customerClaimWhere(), deletedAt: null, ...(line ? { line } : {}) }
        : { AND: [this.wdScope(ctx?.tenantId), line ? { line } : {}] };
    // Search (بیمه‌گزار panel «جستجو»): a 10-digit term matches the deceased's کد ملی exactly (blind
    // index); anything else matches the claim number or the deceased's name.
    const term = (q ?? '').trim().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const nidHash = /^\d{8,10}$/.test(term) ? this.crypto.blindIndex(term.padStart(10, '0')) : null;
    const [rows, desk] = await Promise.all([
      db.claim.findMany({ where: nidHash ? { AND: [where, { OR: [{ deceasedNationalCodeHash: nidHash }, { mainInsuredNationalCodeHash: nidHash }] }] } : where, orderBy: { updatedAt: 'desc' } }),
      this.myDesk(),
    ]);
    const claims = term && !nidHash
      ? rows.filter((c) => c.claimNumber.toLowerCase().includes(term.toLowerCase()) || (c.policyNumber ?? '').includes(term) || (this.crypto.decrypt(c.deceasedFullName) ?? '').includes(term))
      : rows;
    return this.withPolicy(claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.holdsDesk(c, desk) })));
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
      roleLabel: desk.insurerAdmin ? 'مدیر بیمه‌گر (همهٔ مراحل)' : desk.stage ? this.store.labels(desk.tenantId)[desk.stage] : '—',
      tiles,
      sinad: !!(ctx?.tenantId && this.store.get(ctx.tenantId).sinad.enabled), // «روند سیناد»: the panel opens the kartable instead
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
    return this.withPolicy(claims.map((c) => ({ ...(this.present(c) as object), needsAction: this.holdsDesk(c, desk) })));
  }

  // ─────────────────────────── «روند سیناد» (Model View `sinad`, Alborz) ───────────────────────────
  // شعبه works from a Sinad-style kartable: cases climbing to شعبه are allocated to one evaluator in batches,
  // nobody else at the branch sees them, and a new batch comes only when the last one is done. Everything
  // else — which actions exist, who sends a case where — is the chain's own logic (actionsFor).

  /** At a «روند سیناد» شعبه a case allocated to one evaluator is out of the others' hands (admins excepted). */
  private allocatedElsewhere(claim: any, desk: Desk): boolean {
    if (desk.insurerAdmin || claim.currentStage !== 'BRANCH' || claim.flowDirection !== 'UP' || !claim.evaluatorId) return false;
    if (!this.store.get(claim.insurerTenantId).sinad.enabled) return false;
    return claim.evaluatorId !== getContext()?.actorId;
  }

  /** The caller's insurer when it runs «روند سیناد» (else null: the usual میز کار applies). */
  private async sinadDesk() {
    const ctx = getContext();
    if (ctx?.actorType !== 'ORG_USER' || !ctx.tenantId || !ctx.actorId) return null;
    const model = await this.modelOf(ctx.tenantId).catch(() => null);
    if (!model?.sinad.enabled) return null;
    const desk = await this.myDesk();
    if (!desk.stage || desk.stage === 'BROKER') return null;
    return { desk, model, me: ctx.actorId, tenantId: ctx.tenantId };
  }

  private sinadTabs(desk: Desk, me: string) {
    const admin = !!desk.insurerAdmin;
    const branchUp: Prisma.ClaimWhereInput = { currentStage: 'BRANCH', flowDirection: 'UP' };
    const mine: Prisma.ClaimWhereInput = admin ? {} : { evaluatorId: me };
    const open: Prisma.ClaimWhereInput = { status: { notIn: [ClaimStatus.PAID, ClaimStatus.REJECTED] } };
    type T = { key: string; label: string; where: Prisma.ClaimWhereInput; seats: Stage[] };
    const tabs: T[] = [
      { key: 'receive', label: 'در انتظار دریافت مدارک', where: { AND: [open, { currentStage: 'BRANCH', physicalAt: null }, mine] }, seats: ['BRANCH'] },
      { key: 'evaluate', label: 'در انتظار ارزیابی اولیه', where: { ...branchUp, doctorState: null, evaluatorLater: false, ...mine }, seats: ['BRANCH'] },
      { key: 'later', label: 'در انتظار بررسی‌های من', where: { ...branchUp, doctorState: null, evaluatorLater: true, ...mine }, seats: ['BRANCH'] },
      { key: 'doctor', label: 'در انتظار اظهار نظر پزشک معتمد', where: { currentStage: 'BRANCH', doctorState: 'REFER' }, seats: ['BRANCH'] },
      { key: 'exam', label: 'دعوت به معاینه', where: { currentStage: 'BRANCH', doctorState: 'EXAM' }, seats: ['BRANCH'] },
      { key: 'final', label: 'در انتظار ارزیابی نهایی', where: { currentStage: { in: ['HQ', 'COUNCIL'] }, flowDirection: 'UP' }, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
      { key: 'returned', label: 'عودت‌شده — در انتظار ارسال', where: { flowDirection: 'DOWN', flowPurpose: 'DEFICIENCY', currentStage: { in: ['BRANCH', 'HQ', 'COUNCIL'] } }, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
      { key: 'pay', label: 'در انتظار پرداخت خسارت (واریز وجه)', where: { flowPurpose: 'PAYMENT', status: ClaimStatus.APPROVED }, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
      { key: 'paid', label: 'پرداخت شده', where: { status: ClaimStatus.PAID }, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
      { key: 'rejected', label: 'رد شده', where: { status: ClaimStatus.REJECTED }, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
      { key: 'all', label: 'همه پرونده‌ها', where: {}, seats: ['BRANCH', 'HQ', 'COUNCIL'] },
    ];
    return admin ? tabs : tabs.filter((t) => desk.stage && t.seats.includes(desk.stage));
  }

  /** The insurer's cases this caller follows: a شعبه user their branch's (or not yet assigned to a branch). */
  private sinadScope(desk: Desk, tenantId: string): Prisma.ClaimWhereInput {
    const w: Prisma.ClaimWhereInput = { insurerTenantId: tenantId, deletedAt: null, imported: false };
    if (desk.stage === 'BRANCH' && !desk.insurerAdmin && desk.branchId) w.OR = [{ handlingBranchId: desk.branchId }, { handlingBranchId: null }];
    return w;
  }

  /** «کارتابل»: the stage tabs with counts (null when the caller's insurer doesn't run «روند سیناد»). */
  async sinadKartable() {
    const s = await this.sinadDesk();
    if (!s) return { enabled: false as const };
    const db = this.prisma.replica();
    const scope = this.sinadScope(s.desk, s.tenantId);
    const tabs = await Promise.all(this.sinadTabs(s.desk, s.me).map(async (t) => ({ key: t.key, label: t.label, count: await db.claim.count({ where: { AND: [scope, t.where] } }) })));
    const [pool, me] = await Promise.all([
      s.desk.stage === 'BRANCH' ? db.claim.count({ where: { AND: [scope, { currentStage: 'BRANCH', flowDirection: 'UP', evaluatorId: null, doctorState: null }] } }) : 0,
      db.orgUser.findUnique({ where: { id: s.me }, select: { evalBatch: true, evalPaused: true } }),
    ]);
    return {
      enabled: true as const,
      stage: s.desk.stage,
      stageLabel: s.desk.insurerAdmin ? 'مدیر بیمه‌گر (همهٔ مراحل)' : this.store.labels(s.tenantId)[s.desk.stage!],
      admin: !!s.desk.insurerAdmin,
      batchSize: me?.evalBatch ?? s.model.sinad.batchSize,
      paused: !!me?.evalPaused, // the admin paused this evaluator's allocation
      pool, // cases at شعبه not yet allocated to anyone
      tabs,
    };
  }

  /**
   * Allocation, as in Sinad: an evaluator with nothing left in «در انتظار ارزیابی اولیه» gets the next batch
   * of unallocated cases (oldest first). Each case is taken with a conditional update, so two evaluators
   * opening the tab at once never get the same case.
   */
  private async allocateBatch(s: NonNullable<Awaited<ReturnType<ClaimsService['sinadDesk']>>>) {
    if (s.desk.stage !== 'BRANCH' || s.desk.insurerAdmin) return 0;
    const db = this.prisma.unscoped();
    const scope = this.sinadScope(s.desk, s.tenantId);
    // The admin's settings for this evaluator («تخصیص پرونده‌ها»): paused, own batch size, case types.
    const mine = await db.orgUser.findUnique({ where: { id: s.me }, select: { evalBatch: true, evalPaused: true, evalTypes: true } });
    if (mine?.evalPaused) return 0;
    const held = await db.claim.count({ where: { AND: [scope, { currentStage: 'BRANCH', flowDirection: 'UP', evaluatorId: s.me, doctorState: null, evaluatorLater: false }] } });
    if (held > 0) return 0;
    const candidates = await db.claim.findMany({
      where: { AND: [scope, { currentStage: 'BRANCH', flowDirection: 'UP', evaluatorId: null, doctorState: null }, mine?.evalTypes.length ? { claimType: { in: mine.evalTypes } } : {}] },
      orderBy: { updatedAt: 'asc' }, take: mine?.evalBatch ?? s.model.sinad.batchSize, select: { id: true },
    });
    let got = 0;
    for (const c of candidates) {
      const r = await db.claim.updateMany({ where: { id: c.id, evaluatorId: null }, data: { evaluatorId: s.me, evaluatorAt: new Date(), evaluatorLater: false } });
      if (r.count) { got++; await db.claimDeskEvent.create({ data: { claimId: c.id, kind: 'ALLOCATE', actorId: s.me } }); }
    }
    return got;
  }

  /** One kartable tab's rows («در انتظار ارزیابی اولیه» first hands out a new batch when the last is done). */
  async sinadTab(key: string) {
    const s = await this.sinadDesk();
    if (!s) throw new ForbiddenException('کارتابل سیناد برای سازمان شما فعال نیست');
    const tab = this.sinadTabs(s.desk, s.me).find((t) => t.key === key);
    if (!tab) throw new BadRequestException('برگهٔ نامعتبر');
    if (key === 'evaluate') await this.allocateBatch(s);
    const claims = await this.prisma.unscoped().claim.findMany({
      where: { AND: [this.sinadScope(s.desk, s.tenantId), tab.where] }, orderBy: { updatedAt: key === 'evaluate' ? 'asc' : 'desc' }, take: 300,
    });
    const ids = claims.map((c) => c.id);
    const [users, branchSteps, branches] = await Promise.all([
      this.prisma.unscoped().orgUser.findMany({ where: { id: { in: [...new Set(claims.map((c) => c.evaluatorId).filter((x): x is string => !!x))] } }, select: { id: true, displayName: true, username: true } }),
      // «تایید اولیه»: شعبه's last hand-off up (amount, who, when, its note) — the «ارزیابی نهایی» columns
      key === 'final' || key === 'all' ? this.prisma.unscoped().claimStep.findMany({ where: { claimId: { in: ids }, stage: 'BRANCH', action: 'FORWARD', decidedAt: { not: null } }, orderBy: { order: 'desc' }, select: { claimId: true, decidedAt: true, decidedById: true, note: true } }) : Promise.resolve([]),
      this.prisma.unscoped().branch.findMany({ where: { tenantId: s.tenantId }, select: { id: true, name: true, code: true } }),
    ]);
    const deciders = branchSteps.length ? await this.prisma.unscoped().orgUser.findMany({ where: { id: { in: [...new Set(branchSteps.map((x) => x.decidedById).filter((x): x is string => !!x))] } }, select: { id: true, displayName: true, username: true } }) : [];
    const nameOf = new Map([...users, ...deciders].map((u) => [u.id, u.displayName || u.username]));
    const firstUp = new Map<string, (typeof branchSteps)[number]>();
    for (const st of branchSteps) if (!firstUp.has(st.claimId)) firstUp.set(st.claimId, st);
    const branchName = new Map(branches.map((b) => [b.id, `${b.code} - ${b.name}`]));
    const rows = claims.map((c) => {
      const up = firstUp.get(c.id);
      return {
        ...(this.present(c) as object),
        policyholderCompanyId: c.policyholderCompanyId,
        needsAction: this.holdsDesk(c, s.desk),
        evaluatorName: c.evaluatorId ? nameOf.get(c.evaluatorId) ?? '—' : null,
        evaluatorAt: c.evaluatorAt ? toJalali(c.evaluatorAt) : null,
        doctorNote: c.doctorNote,
        fraudCheck: c.fraudCheck,
        physicalAt: c.physicalAt,
        branchName: c.handlingBranchId ? branchName.get(c.handlingBranchId) ?? null : null,
        firstApproval: up ? { amount: c.finalizedAmount?.toString() ?? null, by: (up.decidedById && nameOf.get(up.decidedById)) || null, at: up.decidedAt ? toJalali(up.decidedAt) : null, note: up.note } : null,
      };
    });
    return this.withPolicy(rows);
  }

  /** What the evaluation window shows beyond the case itself: allocation, risk, پزشک معتمد, history, family cases. */
  async sinadCase(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt) throw new NotFoundException('پرونده یافت نشد');
    this.assertParticipant(claim);
    const model = await this.modelOf(claim.insurerTenantId);
    const unscoped = this.prisma.unscoped();
    const hashes = [claim.deceasedNationalCodeHash, claim.mainInsuredNationalCodeHash].filter((x): x is string => !!x);
    const [events, related] = await Promise.all([
      unscoped.claimDeskEvent.findMany({ where: { claimId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      // «خسارت اعضای خانواده»: every other case of this insured or of their main insured's family
      unscoped.claim.findMany({
        where: { id: { not: claimId }, insurerTenantId: claim.insurerTenantId, deletedAt: null, OR: [{ deceasedNationalCodeHash: { in: hashes } }, { mainInsuredNationalCodeHash: { in: hashes } }] },
        orderBy: { createdAt: 'desc' }, take: 20,
      }),
    ]);
    const actorIds = [...new Set([...events.map((e) => e.actorId), claim.evaluatorId].filter((x): x is string => !!x))];
    const users = await unscoped.orgUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, username: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName || u.username]));
    // Risk: simple signals for life / accident cases (Sinad's health score has no meaning here).
    const reasons: string[] = [];
    if (claim.lateNotice) reasons.push('اعلام خسارت پس از مهلت مقرر');
    if (related.length) reasons.push(`${related.length.toLocaleString('fa-IR')} پروندهٔ دیگر برای این بیمه‌شده یا خانوادهٔ او`);
    if (claim.policyholderCompanyId && claim.policyNumber && claim.eventDate) {
      const k = await unscoped.policyholderContract.findFirst({ where: { companyId: claim.policyholderCompanyId, policyNumber: claim.policyNumber }, select: { startDate: true } });
      if (k?.startDate && claim.eventDate.getTime() - k.startDate.getTime() < 90 * 86_400_000 && claim.eventDate >= k.startDate) reasons.push('وقوع حادثه در کمتر از سه ماه از آغاز بیمه‌نامه');
    }
    const level = reasons.length >= 2 ? 'HIGH' : reasons.length === 1 ? 'MEDIUM' : 'LOW';
    const desk = await this.myDesk();
    return {
      enabled: model.sinad.enabled,
      evaluator: claim.evaluatorId ? { id: claim.evaluatorId, name: nameOf.get(claim.evaluatorId) ?? '—', at: claim.evaluatorAt ? toJalali(claim.evaluatorAt) : null, me: claim.evaluatorId === getContext()?.actorId } : null,
      later: claim.evaluatorLater,
      doctor: { state: claim.doctorState, note: claim.doctorNote },
      fraudCheck: claim.fraudCheck,
      risk: { level, reasons },
      canEvaluate: this.holdsDesk(claim, desk) && claim.currentStage === 'BRANCH' && claim.flowDirection === 'UP' && getContext()?.panelMode !== 'ENTRY',
      admin: !!desk.insurerAdmin,
      returnGroups: model.sinad.returnGroups,
      history: events.map((e) => ({ kind: e.kind, label: DESK_EVENT_FA[e.kind] ?? e.kind, note: e.note, by: (e.actorId && nameOf.get(e.actorId)) || '—', at: toJalali(e.createdAt) })),
      related: related.map((r) => ({
        id: r.id, claimNumber: r.claimNumber, claimTypeLabel: caseTypeOf(model, r.claimType)?.label ?? r.claimType, status: r.status,
        name: r.deceasedFullName ? this.crypto.decrypt(r.deceasedFullName) : null, relation: r.insuredRelation ? RELATION_FA[r.insuredRelation as InsuredRelation] ?? null : 'اصلی',
        line: r.line ? kindLabel(r.line) : null, amount: (r.finalizedAmount ?? r.claimedAmount).toString(), createdAt: toJalali(r.createdAt, false),
      })),
    };
  }

  /** Sinad's «اینجا»: give back this evaluator's whole batch, so the next opening of the tab hands out a new one. */
  async sinadReleaseBatch() {
    const s = await this.sinadDesk();
    if (!s) throw new ForbiddenException('کارتابل سیناد برای سازمان شما فعال نیست');
    const db = this.prisma.unscoped();
    const mine = await db.claim.findMany({ where: { insurerTenantId: s.tenantId, evaluatorId: s.me, currentStage: 'BRANCH', flowDirection: 'UP', doctorState: null, evaluatorLater: false }, select: { id: true } });
    if (!mine.length) return { released: 0 };
    await db.claim.updateMany({ where: { id: { in: mine.map((c) => c.id) }, evaluatorId: s.me }, data: { evaluatorId: null, evaluatorAt: null } });
    await db.claimDeskEvent.createMany({ data: mine.map((c) => ({ claimId: c.id, kind: 'RELEASE', actorId: s.me })) });
    return { released: mine.length };
  }

  // ── «تخصیص پرونده‌ها»: the insurer admin's allocation screen ──

  private async sinadAdmin() {
    const s = await this.sinadDesk();
    if (!s) throw new ForbiddenException('کارتابل سیناد برای سازمان شما فعال نیست');
    if (!s.desk.insurerAdmin) throw new ForbiddenException('تخصیص پرونده‌ها با مدیر بیمه‌گر است');
    return s;
  }

  /** شعبه evaluators of this insurer (seated at a branch, allowed to process cases). */
  private async branchEvaluators(tenantId: string) {
    const users = await this.prisma.unscoped().orgUser.findMany({
      where: { tenantId, removedAt: null, branchId: { not: null }, OR: [{ desk: null }, { desk: 'BRANCH' }] },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, username: true, branchId: true, isActive: true, lastLoginAt: true, evalBatch: true, evalPaused: true, evalTypes: true, role: { select: { name: true, permissions: true } } },
    });
    return users.filter((u) => u.role.permissions.includes(PERMISSIONS.CLAIM_PROCESS) || u.role.permissions.includes('*'));
  }

  /** Evaluators with their load and settings, the branches, and every case at شعبه (pool and allocated). */
  async sinadAllocation() {
    const s = await this.sinadAdmin();
    const db = this.prisma.unscoped();
    const [users, branches, claims] = await Promise.all([
      this.branchEvaluators(s.tenantId),
      db.branch.findMany({ where: { tenantId: s.tenantId }, orderBy: { code: 'asc' }, select: { id: true, name: true, code: true } }),
      db.claim.findMany({ where: { insurerTenantId: s.tenantId, deletedAt: null, imported: false, currentStage: 'BRANCH', flowDirection: 'UP' }, orderBy: { updatedAt: 'asc' }, take: 2000 }),
    ]);
    const branchName = new Map(branches.map((b) => [b.id, `${b.code} - ${b.name}`]));
    const userName = new Map(users.map((u) => [u.id, u.displayName || u.username]));
    // Someone outside the list (moved desk, removed) may still hold cases: name them too.
    const strays = [...new Set(claims.map((c) => c.evaluatorId).filter((x): x is string => !!x && !userName.has(x)))];
    if (strays.length) (await db.orgUser.findMany({ where: { id: { in: strays } }, select: { id: true, displayName: true, username: true } })).forEach((u) => userName.set(u.id, u.displayName || u.username));
    const state = (c: (typeof claims)[number]) => (c.doctorState ? 'doctor' : !c.evaluatorId ? 'pool' : c.evaluatorLater ? 'later' : 'evaluate');
    const load = new Map<string, { evaluate: number; later: number; doctor: number }>();
    for (const c of claims) {
      if (!c.evaluatorId) continue;
      const l = load.get(c.evaluatorId) ?? { evaluate: 0, later: 0, doctor: 0 };
      const st = state(c);
      if (st === 'evaluate' || st === 'later' || st === 'doctor') l[st]++;
      load.set(c.evaluatorId, l);
    }
    return {
      batchSize: s.model.sinad.batchSize,
      caseTypes: s.model.form.caseTypes.map((t) => ({ code: t.code, label: t.label })),
      branches: branches.map((b) => ({ id: b.id, name: `${b.code} - ${b.name}` })),
      evaluators: users.map((u) => ({
        id: u.id, name: u.displayName || u.username, username: u.username, role: u.role.name, branchId: u.branchId, branchName: u.branchId ? branchName.get(u.branchId) ?? null : null,
        active: u.isActive, lastLoginAt: u.lastLoginAt ? toJalali(u.lastLoginAt) : null,
        batchSize: u.evalBatch, paused: u.evalPaused, claimTypes: u.evalTypes,
        load: load.get(u.id) ?? { evaluate: 0, later: 0, doctor: 0 },
      })),
      cases: claims.map((c) => {
        const p = this.present(c) as any;
        return {
          id: c.id, claimNumber: c.claimNumber, policyNumber: p.policyNumber, name: p.deceasedName, nationalCode: p.deceasedNationalCode,
          claimType: c.claimType, claimTypeLabel: p.claimTypeLabel, amount: p.payableAmount,
          branchId: c.handlingBranchId, branchName: c.handlingBranchId ? branchName.get(c.handlingBranchId) ?? null : null,
          evaluatorId: c.evaluatorId, evaluatorName: c.evaluatorId ? userName.get(c.evaluatorId) ?? '—' : null,
          evaluatorAt: c.evaluatorAt ? toJalali(c.evaluatorAt) : null, state: state(c), since: toJalali(c.updatedAt, false),
        };
      }),
    };
  }

  /** Hand cases to one evaluator (of the case's branch), or back to the pool when `userId` is null. */
  async sinadAssign(claimIds: string[], userId: string | null) {
    const s = await this.sinadAdmin();
    const db = this.prisma.unscoped();
    const to = userId ? (await this.branchEvaluators(s.tenantId)).find((u) => u.id === userId && u.isActive) : null;
    if (userId && !to) throw new BadRequestException('ارزیاب یافت نشد یا غیرفعال است');
    const claims = await db.claim.findMany({
      where: { id: { in: claimIds }, insurerTenantId: s.tenantId, deletedAt: null, currentStage: 'BRANCH', flowDirection: 'UP', status: { notIn: [ClaimStatus.PAID, ClaimStatus.REJECTED] } },
      select: { id: true, handlingBranchId: true, evaluatorId: true },
    });
    let done = 0, otherBranch = 0;
    for (const c of claims) {
      if (to && c.handlingBranchId && c.handlingBranchId !== to.branchId) { otherBranch++; continue; }
      if ((to?.id ?? null) === c.evaluatorId) continue;
      await db.claim.update({ where: { id: c.id }, data: to ? { evaluatorId: to.id, evaluatorAt: new Date(), evaluatorLater: false } : { evaluatorId: null, evaluatorAt: null, evaluatorLater: false } });
      await db.claimDeskEvent.create({ data: { claimId: c.id, kind: to ? 'ASSIGN' : 'UNASSIGN', note: to ? `به ${to.displayName || to.username}` : null, actorId: s.me } });
      done++;
    }
    return { done, otherBranch, notAtBranch: claimIds.length - claims.length };
  }

  /** One evaluator's allocation settings: own batch size (null → Model View's), paused, case types. */
  async sinadEvaluatorSettings(userId: string, input: { batchSize?: number | null; paused: boolean; claimTypes: string[] }) {
    const s = await this.sinadAdmin();
    const u = (await this.branchEvaluators(s.tenantId)).find((x) => x.id === userId);
    if (!u) throw new NotFoundException('ارزیاب یافت نشد');
    const known = new Set(s.model.form.caseTypes.map((t) => t.code));
    await this.prisma.unscoped().orgUser.update({
      where: { id: userId },
      data: { evalBatch: input.batchSize ?? null, evalPaused: input.paused, evalTypes: [...new Set(input.claimTypes.filter((c) => known.has(c)))] },
    });
    return { ok: true };
  }

  /** Branch colleagues a case can be referred to («ارجاع»). */
  async sinadEvaluators() {
    const s = await this.sinadDesk();
    if (!s) return [];
    const users = await this.prisma.unscoped().orgUser.findMany({
      where: { tenantId: s.tenantId, isActive: true, ...(s.desk.branchId && !s.desk.insurerAdmin ? { branchId: s.desk.branchId } : { branchId: { not: null } }) },
      orderBy: { displayName: 'asc' }, select: { id: true, displayName: true, username: true, branchId: true, desk: true },
    });
    return users.filter((u) => u.id !== s.me && (u.desk == null || u.desk === 'BRANCH')).map((u) => ({ id: u.id, name: u.displayName || u.username }));
  }

  /**
   * Kartable operations on one case. They never move it along the chain (that is `act`): they decide who at
   * شعبه holds it and record the evaluator's own steps.
   */
  async sinadOp(claimId: string, op: string, input: { note?: string; userId?: string }) {
    const s = await this.sinadDesk();
    if (!s) throw new ForbiddenException('کارتابل سیناد برای سازمان شما فعال نیست');
    const db = this.prisma.unscoped();
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim || claim.deletedAt || claim.insurerTenantId !== s.tenantId) throw new NotFoundException('پرونده یافت نشد');
    assertNotPaid(claim);
    const note = input.note?.trim().slice(0, 1000) || null;
    const atBranch = claim.currentStage === 'BRANCH';
    const holds = this.holdsDesk(claim, s.desk);
    const event = (kind: string, n: string | null = note) => db.claimDeskEvent.create({ data: { claimId, kind, note: n, actorId: s.me } });
    const need = (ok: boolean, msg: string) => { if (!ok) throw new BadRequestException(msg); };
    switch (op) {
      case 'take': // pick an unallocated case (or, for an admin, any) into my kartable
        need(atBranch && holds, 'پرونده در شعبهٔ شما نیست');
        need(!claim.evaluatorId || s.desk.insurerAdmin === true, 'این پرونده به ارزیاب دیگری تخصیص یافته است');
        await db.claim.update({ where: { id: claimId }, data: { evaluatorId: s.me, evaluatorAt: new Date(), evaluatorLater: false } });
        await event('ALLOCATE');
        break;
      case 'release': // «خارج کردن از کارتابل»: back to the branch's pool (an admin: take it back from anyone)
        need(claim.evaluatorId === s.me || s.desk.insurerAdmin === true, 'این پرونده در کارتابل شما نیست');
        await db.claim.update({ where: { id: claimId }, data: { evaluatorId: null, evaluatorAt: null, evaluatorLater: false } });
        await event('RELEASE');
        break;
      case 'refer': { // «ارجاع» to another evaluator of the branch
        need(atBranch && holds, 'پرونده در اختیار شما نیست');
        const to = input.userId ? await db.orgUser.findFirst({ where: { id: input.userId, tenantId: s.tenantId, isActive: true }, select: { id: true, displayName: true, username: true, branchId: true } }) : null;
        need(!!to && (!claim.handlingBranchId || to.branchId === claim.handlingBranchId), 'ارزیاب را از همین شعبه انتخاب کنید');
        await db.claim.update({ where: { id: claimId }, data: { evaluatorId: to!.id, evaluatorAt: new Date(), evaluatorLater: false } });
        await event('REFER', [`به ${to!.displayName || to!.username}`, note].filter(Boolean).join(' — '));
        break;
      }
      case 'later': // «بعدا بررسی میکنم»
      case 'resume':
        need(atBranch && holds, 'پرونده در اختیار شما نیست');
        await db.claim.update({ where: { id: claimId }, data: { evaluatorLater: op === 'later', evaluatorId: claim.evaluatorId ?? s.me, evaluatorAt: claim.evaluatorAt ?? new Date() } });
        if (op === 'later') await event('LATER');
        break;
      case 'doctor-refer': // «ارجاع به پزشک معتمد»
      case 'doctor-exam': // «دعوت به معاینه»
        need(atBranch && claim.flowDirection === 'UP' && holds, 'پرونده در اختیار شما نیست');
        await db.claim.update({ where: { id: claimId }, data: { doctorState: op === 'doctor-refer' ? 'REFER' : 'EXAM', evaluatorId: claim.evaluatorId ?? s.me, evaluatorAt: claim.evaluatorAt ?? new Date() } });
        await event(op === 'doctor-refer' ? 'DOCTOR_REFER' : 'DOCTOR_EXAM');
        break;
      case 'doctor-opinion': // «اظهار نظر پزشک معتمد»: back to the evaluator's «در انتظار ارزیابی اولیه»
        need(atBranch && !!claim.doctorState, 'پرونده نزد پزشک معتمد نیست');
        need(s.desk.stage === 'BRANCH' || s.desk.insurerAdmin === true, 'اظهار نظر پزشک معتمد در شعبه ثبت می‌شود');
        need(!!note, 'متن اظهار نظر را بنویسید');
        await db.claim.update({ where: { id: claimId }, data: { doctorState: null, doctorNote: note, evaluatorLater: false } });
        await event('DOCTOR_OPINION');
        break;
      case 'fraud-clean': // «بررسی کردم، تقلب نیست»
      case 'fraud-flag': // «تقلب است، عودت شود»
        need(atBranch && holds, 'پرونده در اختیار شما نیست');
        await db.claim.update({ where: { id: claimId }, data: { fraudCheck: op === 'fraud-clean' ? 'CLEAN' : 'FRAUD' } });
        await event(op === 'fraud-clean' ? 'FRAUD_CLEAN' : 'FRAUD_FLAG');
        break;
      case 'note': // «یادداشت ارزیاب»
        need(!!note, 'متن یادداشت را بنویسید');
        await event('NOTE');
        break;
      default:
        throw new BadRequestException('عملیات نامعتبر');
    }
    return this.sinadCase(claimId);
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
    // کد ملی بیمه‌شده اصلی: the main insured's own cases and their dependents'.
    if (clean(q.mainNationalCode)) {
      const h = this.crypto.blindIndex(clean(q.mainNationalCode).replace(/\D/g, ''));
      if (h) and.push({ OR: [{ mainInsuredNationalCodeHash: h }, { deceasedNationalCodeHash: h, insuredRelation: null }, { deceasedNationalCodeHash: h, insuredRelation: 'MAIN' }] });
    }
    // کد ملی بیمه‌شده فرعی: that dependent's cases only.
    if (clean(q.subNationalCode)) {
      const h = this.crypto.blindIndex(clean(q.subNationalCode).replace(/\D/g, ''));
      if (h) and.push({ deceasedNationalCodeHash: h, insuredRelation: { in: DEPENDENT_RELATIONS } });
    }
    if (clean(q.insurerTenantId)) and.push({ insurerTenantId: clean(q.insurerTenantId) });
    if (clean(q.brokerTenantId)) and.push({ brokerTenantId: clean(q.brokerTenantId) });
    if (q.claimType) and.push({ claimType: q.claimType });
    if (q.line && isKind(q.line)) and.push({ line: q.line }); // نوع بیمه‌نامه
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
    return this.withPolicy(claims.map((c) => ({ ...(this.present(c) as object), needsAction: false })));
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

  /** Every نوع پرونده of the insurers this organization works with, for the staff forms and filters. */
  /** Every نوع پرونده the caller's insurers define; with `line`, only that نوع بیمه‌نامه's (panel 1). */
  async caseTypeOptions(line?: Line) {
    const tenantId = getTenantIdOrThrow();
    const db = this.db();
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
    const insurerIds = tenant?.kind === 'INSURER' ? [tenantId]
      : (await db.brokerInsurerPartnership.findMany({ where: { brokerTenantId: tenantId, isActive: true }, select: { insurerTenantId: true } })).map((p) => p.insurerTenantId);
    // Each type also carries its «علت» list and what panel 1 calls it in this kind («علت فوت» / «علت خسارت»).
    const out = new Map<string, { code: string; label: string; causeGroup: string; death: boolean; causes: string[]; causeLabel: string; detail?: CaseDetail | null }>();
    for (const id of insurerIds) {
      const m = await this.modelOf(id);
      for (const t of m.form.caseTypes) {
        if (out.has(t.code) || (line && !lineForm(m, line).claimTypes.includes(t.code))) continue;
        const kind = line ?? Object.keys(m.form.lines).find((l) => lineForm(m, l).claimTypes.includes(t.code));
        out.set(t.code, { ...t, causes: causesOf(m, t.code), causeLabel: kind ? lineForm(m, kind).causeLabel : 'علت خسارت' });
      }
    }
    return [...out.values()];
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

  /** Case rows + their بیمه‌گزار and the period of their بیمه‌نامه (آغاز / پایان پوشش), for the lists. */
  private async withPolicy<T extends object>(rows: T[]) {
    const list = rows as (T & { policyNumber?: string | null; policyholderCompanyId?: string | null })[];
    const companyIds = [...new Set(list.map((r) => r.policyholderCompanyId).filter((x): x is string => !!x))];
    const db = this.prisma.unscoped();
    const [contracts, companies] = companyIds.length
      ? await Promise.all([
        db.policyholderContract.findMany({ where: { companyId: { in: companyIds } }, select: { companyId: true, policyNumber: true, startDate: true, endDate: true } }),
        db.policyholderCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      ])
      : [[], []];
    const period = new Map(contracts.map((k) => [`${k.companyId}|${k.policyNumber}`, k]));
    const name = new Map(companies.map((co) => [co.id, co.name]));
    return list.map((r) => {
      const k = period.get(`${r.policyholderCompanyId}|${r.policyNumber}`);
      return {
        ...r,
        companyName: (r.policyholderCompanyId && name.get(r.policyholderCompanyId)) || null,
        policyStart: k?.startDate ? toJalali(k.startDate, false) : null,
        policyEnd: k?.endDate ? toJalali(k.endDate, false) : null,
      };
    });
  }

  private present(c: any, full = false) {
    const base = {
      coverageStatus: c.coverageStatus ?? null,
      insuredLinkEnabled: this.store.get(c.insurerTenantId).insured.enabled,
      id: c.id,
      claimNumber: c.claimNumber,
      status: c.status,
      claimType: c.claimType,
      claimTypeLabel: caseTypeOf(this.store.get(c.insurerTenantId), c.claimType)?.label ?? c.claimType,
      claimTypeDeath: caseTypeOf(this.store.get(c.insurerTenantId), c.claimType)?.death ?? false,
      causeDetail: c.causeDetail ?? null, // «نوع حادثه»
      caseDetail: caseTypeOf(this.store.get(c.insurerTenantId), c.claimType)?.detail ?? null, // the choice and the causes that ask it
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
      insuredRelation: c.insuredRelation ?? null,
      line: c.line ?? null, // نوع بیمه‌نامه
      lineLabel: c.line ? kindLabel(c.line) : null,
      mainInsuredName: c.mainInsuredName ? this.crypto.decrypt(c.mainInsuredName) : null,
      mainInsuredNationalCode: c.mainInsuredNationalCode ? this.crypto.decrypt(c.mainInsuredNationalCode) : null,
      deceasedBirthDate: c.deceasedBirthDate ? toJalali(c.deceasedBirthDate, false) : null,
      deceasedAge: ageAt(c.deceasedBirthDate, c.eventDate),
      causeOfDeath: c.causeOfDeath ?? null,
      policyholderCompanyId: c.policyholderCompanyId ?? null,
      imported: !!c.imported, // brought in from Excel («ورود دسته‌ای») — its filing date is only the import date
      noticeDeadline: c.noticeDeadline ? toJalali(c.noticeDeadline, false) : null,
      lateNotice: c.lateNotice,
      createdAt: c.createdAt ? toJalali(c.createdAt) : null,
      currentStage: c.currentStage ?? null,
      currentStageLabel: c.currentStage ? this.store.labels(c.insurerTenantId)[c.currentStage as Stage] : null,
      flowDirection: c.flowDirection ?? null,
      flowPurpose: c.flowPurpose ?? null,
    };
    if (!full) return base;
    const paid = (c.steps ?? []).find((s: any) => s.action === 'MARK_PAID' && s.decidedAt);
    return {
      ...base,
      paidDate: paid ? toJalali(paid.decidedAt, false) : null, // تاریخ پرداخت
      lossNotice: lossNoticeEntry(c, this.store.labels(c.insurerTenantId).BRANCH),
      steps: (c.steps ?? []).map((s: any) => ({
        order: s.order, partyType: s.partyType, stage: s.stage ?? null, stageLabel: s.stage ? this.store.labels(c.insurerTenantId)[s.stage as Stage] : null,
        direction: s.direction, purpose: s.purpose ?? null, state: s.state, action: s.action ?? null,
        levelId: s.levelId, holderTenantId: s.holderTenantId, note: s.note, decidedAt: s.decidedAt ? toJalali(s.decidedAt) : null,
        letters: (c.letters ?? []).filter((l: any) => l.stepId === s.id).map((l: any) => ({
          id: l.id, number: l.number, chargoonNo: l.chargoonNo ?? null, subject: l.subject, date: l.letterDate ? toJalali(l.letterDate, false) : null, hasFile: !!l.storageKey, fileName: l.fileName,
        })),
      })),
      deficiencies: (c.deficiencies ?? []).map((d: any) => ({ items: safeParse(d.items), slots: d.slots ? safeParse(d.slots) : [], raisedByStepId: d.raisedByStepId, raisedByLabel: (() => { const st = (c.steps ?? []).find((x: any) => x.id === d.raisedByStepId); return st?.stage ? this.store.labels(c.insurerTenantId)[st.stage as Stage] ?? null : null; })(), createdAt: d.createdAt ? toJalali(d.createdAt) : null, resolvedAt: d.resolvedAt ? toJalali(d.resolvedAt) : null })),
    };
  }
}

/**
 * «ثبت اعلام خسارت» for the case timelines (every panel): when شعبه recorded it, and after which hand-off
 * (`afterOrder`: the last step decided before it; 0 = before all of them) so it shows in its place.
 */
export function lossNoticeEntry(c: { lossNoticeDate?: Date | null; lossNoticeNumber?: string | null; steps?: { order: number; decidedAt: Date | null }[] }, branchLabel: string) {
  if (!c.lossNoticeDate) return null;
  const at = c.lossNoticeDate.getTime();
  const before = (c.steps ?? []).filter((s) => s.decidedAt && s.decidedAt.getTime() <= at);
  return {
    stageLabel: branchLabel,
    at: toJalali(c.lossNoticeDate),
    number: c.lossNoticeNumber ?? null,
    afterOrder: before.length ? Math.max(...before.map((s) => s.order)) : 0,
  };
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
  { key: 'insuredRelation', label: 'نوع بیمه‌شده', group: 'بیمه‌شده', type: 'text' },
  { key: 'mainInsuredName', label: 'نام بیمه‌شدهٔ اصلی', group: 'بیمه‌شده', type: 'text' },
  { key: 'birthDate', label: 'تاریخ تولد', group: 'بیمه‌شده', type: 'date' },
  { key: 'age', label: 'سن هنگام فوت/حادثه', group: 'بیمه‌شده', type: 'number' },
  { key: 'causeOfDeath', label: 'علت خسارت', group: 'بیمه‌شده', type: 'text' },
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
