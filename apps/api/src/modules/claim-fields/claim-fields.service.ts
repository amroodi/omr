import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ClaimPartyType, FieldSource } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getContext } from '../../common/tenant/tenant-context';
import { validateField } from '../../common/validation/field-validation';

export interface OcrDraftField {
  key: string;
  value: string;
  confidence: number;
}

@Injectable()
export class ClaimFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private db() {
    return this.prisma.unscoped();
  }

  private async loadClaim(claimId: string) {
    const claim = await this.db().claim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('پرونده یافت نشد');
    return claim;
  }

  /** The party (authority) the caller acts as on this claim. */
  private callerParty(claim: any): ClaimPartyType | null {
    const ctx = getContext();
    if (ctx?.actorType === 'CUSTOMER' && claim.policyHolderId === ctx.actorId) return 'POLICYHOLDER';
    if (ctx?.actorType === 'ORG_USER') {
      if (ctx.tenantId === claim.insurerTenantId) return 'INSURER_LEVEL';
      if (ctx.tenantId === claim.brokerTenantId) return 'MOAREF';
    }
    if (ctx?.actorType === 'SUPER_ADMIN') return 'INSURER_LEVEL';
    return null;
  }

  private party(claim: any): ClaimPartyType {
    const p = this.callerParty(claim);
    if (!p) throw new ForbiddenException('دسترسی به این پرونده ندارید');
    return p;
  }

  /** Field definitions (grouped) with the claim's current values, provenance, and edit rights. */
  async listForClaim(claimId: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const defs = await this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, orderBy: { order: 'asc' } });
    const values = await this.db().claimFieldValue.findMany({ where: { claimId } });
    const vmap = new Map(values.map((v) => [v.key, v]));

    const groups: Record<string, any[]> = { CLAIM_DATA: [], BENEFICIARY: [], WORKFLOW_STAGE: [] };
    for (const d of defs) {
      const v = vmap.get(d.key);
      groups[d.group].push({
        key: d.key,
        label: d.label,
        type: d.type,
        options: d.options,
        required: d.required,
        value: v?.value ?? null,
        source: v?.source ?? null,
        confidence: v?.confidence ?? null,
        confirmed: !!v?.confirmedAt,
        canEdit: d.editableBy.includes(party),
      });
    }
    return { claimId, party, groups };
  }

  /** Human sets/corrects a field value (validated, provenance recorded, implicitly confirmed). */
  async setValue(claimId: string, key: string, value: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const def = await this.db().claimFieldDef.findFirst({ where: { tenantId: claim.insurerTenantId, key } });
    if (!def) throw new NotFoundException('فیلد تعریف نشده است');
    if (!def.editableBy.includes(party)) throw new ForbiddenException('اجازه ویرایش این فیلد را ندارید');

    const maxAmount = key === 'payable_amount' ? await this.sumInsuredCeiling(claimId) : undefined;
    const check = validateField(def.type, value, { options: def.options, maxAmount });
    if (!check.valid) throw new BadRequestException(check.message);

    const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key } } });
    const source: FieldSource = existing?.source === 'OCR' ? 'OCR_CORRECTED' : 'MANUAL';
    const actor = getContext()?.actorId ?? null;
    const saved = await this.db().claimFieldValue.upsert({
      where: { claimId_key: { claimId, key } },
      update: { value, source, confirmedById: actor, confirmedAt: new Date(), updatedById: actor },
      create: { claimId, key, value, source, confirmedById: actor, confirmedAt: new Date(), updatedById: actor },
    });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimField', targetId: claimId, metadata: { key, source } });
    return { key, value: saved.value, source: saved.source, confirmed: true };
  }

  /** Confirm an OCR draft as-is (the human accepts the extracted value without editing). */
  async confirmValue(claimId: string, key: string) {
    const claim = await this.loadClaim(claimId);
    const party = this.party(claim);
    const def = await this.db().claimFieldDef.findFirst({ where: { tenantId: claim.insurerTenantId, key } });
    if (!def || !def.editableBy.includes(party)) throw new ForbiddenException('اجازه تایید این فیلد را ندارید');
    const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key } } });
    if (!existing) throw new NotFoundException('مقداری برای تایید وجود ندارد');
    const actor = getContext()?.actorId ?? null;
    await this.db().claimFieldValue.update({ where: { claimId_key: { claimId, key } }, data: { confirmedById: actor, confirmedAt: new Date() } });
    await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimFieldConfirm', targetId: claimId, metadata: { key } });
    return { key, confirmed: true };
  }

  /**
   * Ingest OCR-extracted draft values (shadow mode): fill only blank or unconfirmed fields, and
   * NEVER overwrite a human-confirmed value. Everything stays unconfirmed until a human confirms.
   */
  async ingestOcrDraft(claimId: string, sourceDocId: string, fields: OcrDraftField[]) {
    const claim = await this.loadClaim(claimId);
    const defKeys = new Set((await this.db().claimFieldDef.findMany({ where: { tenantId: claim.insurerTenantId, isActive: true }, select: { key: true } })).map((d) => d.key));
    let drafted = 0;
    for (const f of fields) {
      if (!defKeys.has(f.key)) continue;
      const existing = await this.db().claimFieldValue.findUnique({ where: { claimId_key: { claimId, key: f.key } } });
      if (existing?.confirmedAt) continue; // never overwrite confirmed human data
      await this.db().claimFieldValue.upsert({
        where: { claimId_key: { claimId, key: f.key } },
        update: { value: f.value, source: 'OCR', confidence: f.confidence, sourceDocId, confirmedById: null, confirmedAt: null },
        create: { claimId, key: f.key, value: f.value, source: 'OCR', confidence: f.confidence, sourceDocId, confirmedById: null, confirmedAt: null },
      });
      drafted++;
    }
    if (drafted) await this.audit.record({ action: AuditAction.EDIT, tenantId: claim.insurerTenantId, targetType: 'ClaimFieldOCR', targetId: claimId, metadata: { drafted, sourceDocId } });
    return { drafted };
  }

  /** The ceiling for مبلغ قابل پرداخت: the larger of سرمایه فوت / سرمایه حادثه, if set. */
  private async sumInsuredCeiling(claimId: string): Promise<number | undefined> {
    const vals = await this.db().claimFieldValue.findMany({ where: { claimId, key: { in: ['death_capital', 'accident_capital'] } } });
    const nums = vals.map((v) => Number((v.value ?? '').replace(/[^\d.]/g, ''))).filter((n) => !Number.isNaN(n) && n > 0);
    return nums.length ? Math.max(...nums) : undefined;
  }
}
