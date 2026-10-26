import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ClaimFieldsService } from '../claim-fields/claim-fields.service';
import { ClaimsService } from './claims.service';
import { ActionDto, DecisionDto, FileClaimDto, FileOnBehalfDto, LetterDto, LossNoticeDto, PhysicalDto } from './dto';

const docLimits = { fileSize: 15 * 1024 * 1024 };

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly fields: ClaimFieldsService,
  ) {}

  /** File a death claim (بیمه‌گزار / broker on their behalf). */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post()
  file(@Body() dto: FileClaimDto) {
    return this.claims.file(dto);
  }

  // Also feeds the «پرونده جدید» form (any staff who files claims), not only filing on behalf.
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Get('on-behalf/companies')
  onBehalfCompanies() {
    return this.claims.onBehalfCompanies();
  }

  /** کارگزاری opens a case for one of its بیمه‌گزار companies and uploads the documents for them. */
  @Permissions(PERMISSIONS.CLAIM_FILE_ON_BEHALF)
  @Post('on-behalf')
  fileOnBehalf(@Body() dto: FileOnBehalfDto) {
    return this.claims.fileOnBehalf(dto);
  }

  /** All claims the caller participates in. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get()
  list() {
    return this.claims.listMine();
  }

  /** Soft-delete a claim (admin only; audit-logged, restorable within the retention window). */
  @Permissions(PERMISSIONS.CLAIM_DELETE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.claims.remove(id);
  }

  /** Recycle bin: soft-deleted claims still restorable (with days left before permanent purge). */
  @Permissions(PERMISSIONS.CLAIM_DELETE)
  @Get('trash')
  trash() {
    return this.claims.listTrash();
  }

  /** Undo a soft-delete (restore the claim). */
  @Permissions(PERMISSIONS.CLAIM_DELETE)
  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.claims.restore(id);
  }

  /** The caller's action queue (claims awaiting their step). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('queue')
  queue() {
    return this.claims.queue();
  }

  /** میز کار: the operator's permission-gated work queues with live counts + a summary. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('work-desk')
  workDesk() {
    return this.claims.workDesk();
  }

  /** The claim list behind one Work Desk queue tile (?key=all|my-review|authenticity|…). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('work-desk/queue')
  workDeskQueue(@Query('key') key: string) {
    return this.claims.workDeskQueue(key);
  }

  /** «گزارش‌گیری»: every visible claim flattened with all its facts and fields (report builder data). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('report-data')
  reportData() {
    return this.claims.reportData();
  }

  /** Advanced search (جستجوی پیشرفته) over the caller's claims. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('search')
  search(@Query() q: Record<string, string>) {
    return this.claims.searchClaims(q);
  }

  /** Document types (across all kinds) for the «نوع مدرک» search filter. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('doc-types')
  docTypes() {
    return this.claims.docTypes();
  }

  /** Active insurers to file a claim against (also used by the claims-list filter). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('insurers')
  insurers() {
    return this.claims.listInsurers();
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  /** Required-document checklist (filtered by the claim's cause of death). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/checklist')
  checklist(@Param('id') id: string) {
    return this.claims.checklist(id);
  }

  /** Claim data/workflow fields, grouped, with values, provenance and edit rights. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/fields')
  fieldsList(@Param('id') id: string) {
    return this.fields.listForClaim(id);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Put(':id/fields/:key')
  async setField(@Param('id') id: string, @Param('key') key: string, @Body() body: { value: string }) {
    const saved = await this.fields.setValue(id, key, body?.value ?? '');
    await this.claims.applyManualOutcome(id, key, saved.value); // «تکمیل دستی»: the case follows the typed outcome
    return saved;
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/fields/:key/confirm')
  confirmField(@Param('id') id: string, @Param('key') key: string) {
    return this.fields.confirmValue(id, key);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/documents')
  documents(@Param('id') id: string) {
    return this.claims.listDocuments(id);
  }

  /** Download/preview a claim document (any party to the claim). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/documents/:docId/file')
  async docFile(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.claims.getDocumentFile(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  /** All current documents of the claim in one ZIP («دریافت همهٔ مدارک»). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/documents-zip')
  async documentsZip(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.claims.documentsZip(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  /** Every ✓/✕ change on one document, explained in Persian (assessment page history). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/documents/:docId/history')
  documentHistory(@Param('id') id: string, @Param('docId') docId: string) {
    return this.claims.documentHistory(id, docId);
  }

  /** Upload a document to the claim, tagged with the required-document code it satisfies. */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: docLimits }))
  uploadDocument(@Param('id') id: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File) {
    return this.claims.uploadDocument(id, file, docCode);
  }

  /** Approve / reject / request-info on an uploaded document (document-authenticity assessor). */
  @Permissions(PERMISSIONS.DOC_VERIFY)
  @Post(':id/documents/:docId/verify')
  verifyDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() body: { action: 'approve' | 'reject' | 'needs_info'; note?: string },
  ) {
    return this.claims.verifyDocument(id, docId, body?.action, body?.note);
  }

  /** Set a per-document approval at the caller's desk (کارگزاری/شعبه/ستاد/شورای فنی). */
  @Permissions(PERMISSIONS.DOC_VERIFY)
  @Post(':id/documents/:docId/review')
  reviewDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() body: { stage: 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL'; state: 'PENDING' | 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.claims.reviewDocument(id, docId, body?.stage, body?.state, body?.note);
  }

  /** Record the finalized damage amount (مبلغ خسارت قطعی) after assessment. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Put(':id/finalized-amount')
  setFinalizedAmount(@Param('id') id: string, @Body() body: { amount: string }) {
    return this.claims.setFinalizedAmount(id, body?.amount);
  }

  /** Take a workflow action offered in `workflow.actions` of GET /claims/:id (see workflow.ts). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/action')
  act(@Param('id') id: string, @Body() dto: ActionDto) {
    return this.claims.act(id, dto);
  }

  /** Relay / send / receive / return the original (physical) documents. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post(':id/physical')
  physical(@Param('id') id: string, @Body() dto: PhysicalDto) {
    return this.claims.physicalAct(id, dto);
  }

  /** شعبه records اعلام خسارت (registered in the insurer's own system). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Put(':id/loss-notice')
  setLossNotice(@Param('id') id: string, @Body() dto: LossNoticeDto) {
    return this.claims.setLossNotice(id, dto.number, dto.date);
  }

  /** Create a letter (مکاتبه) to attach to the next action; returns its id. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post(':id/letters')
  @UseInterceptors(FileInterceptor('file', { limits: docLimits }))
  createLetter(@Param('id') id: string, @Body() dto: LetterDto, @UploadedFile() file?: Express.Multer.File) {
    return this.claims.createLetter(id, dto, file);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/letters/:letterId/file')
  async letterFile(@Param('id') id: string, @Param('letterId') letterId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.claims.getLetterFile(id, letterId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }
}
