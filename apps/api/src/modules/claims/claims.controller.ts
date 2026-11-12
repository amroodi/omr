import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { EntryAllowed, EntryOnly, Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ClaimFieldsService } from '../claim-fields/claim-fields.service';
import { CoverageService } from '../model-view/coverage.service';
import { CoverageCheckDto, StaffCoverageCheckDto } from '../customer/dto';
import { ClaimsService } from './claims.service';
import { asLine } from './workflow';
import { ConcessionDto, DoctorAnswerDto, SinadOpDto, SinadAssignDto, EvaluatorSettingsDto, ActionDto, DecisionDto, FileClaimDto, FileOnBehalfDto, FilingEditDto, HeirsDto, LetterDto, LossNoticeDto, PhysicalDto, RectifyDto } from './dto';

const docLimits = { fileSize: 15 * 1024 * 1024 };

@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly fields: ClaimFieldsService,
    private readonly coverage: CoverageService,
  ) {}

  /** «اعلام خسارت» for the caller: allowed? on which desks may the case start? */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Get('notice-options')
  noticeOptions() {
    return this.claims.noticeOptions();
  }

  /** Org admin: «اعلام خسارت» rules of this organization. */
  @Permissions(PERMISSIONS.TENANT_SETTINGS)
  @Get('notice-rules')
  noticeRules() {
    return this.claims.noticeRules();
  }

  /** File a death claim (بیمه‌گزار / broker on their behalf). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post()
  file(@Body() dto: FileClaimDto) {
    return this.claims.file(dto);
  }

  // Also feeds the «پرونده جدید» form (any staff who files claims), not only filing on behalf.
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('case-types')
  caseTypes(@Query('line') line?: string) {
    return this.claims.caseTypeOptions(asLine(line));
  }

  /** Panel 1 of an insurer: partner کارگزاری‌ها and their companies, شعبه‌ها, and the entry way. */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Get('entry-options')
  entryOptions() {
    return this.claims.insurerEntryOptions();
  }

  /** Panel 1's «مشخصات بیمه نامه»: the بیمه‌گزاران and their بیمه‌نامه‌ها this organization works with. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('entry-policies')
  entryPolicies() {
    return this.claims.entryPolicies();
  }

  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Get('on-behalf/companies')
  onBehalfCompanies() {
    return this.claims.onBehalfCompanies();
  }

  /** One company's بیمه‌نامه‌ها for the filing form (same as the بیمه‌گزار panel's). */
  @Permissions(PERMISSIONS.CLAIM_FILE_ON_BEHALF)
  @Get('on-behalf/companies/:companyId/policies')
  onBehalfPolicies(@Param('companyId', ParseUUIDPipe) companyId: string, @Query('line') line?: string) {
    return this.claims.onBehalfPolicies(companyId, asLine(line));
  }

  /** Coverage inquiry while filing for a بیمه‌گزار (`enabled: false` while Super Admin has it off). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_FILE_ON_BEHALF)
  @Post('on-behalf/coverage-check')
  async onBehalfCoverage(@Body() dto: CoverageCheckDto) {
    if (!dto.contractId) throw new BadRequestException('بیمه‌نامه را انتخاب کنید');
    const r = await this.coverage.lookup(await this.claims.insurerOfContract(dto.contractId), dto.nationalCode, dto.eventDate ? new Date(dto.eventDate) : null);
    return r ? { enabled: true, ...r } : { enabled: false };
  }

  /** The same inquiry on the staff's own «ثبت پرونده خسارت» form (an insurer's or a brokerage's panel 1). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post('coverage-check')
  async staffCoverage(@Body() dto: StaffCoverageCheckDto) {
    const r = await this.coverage.lookup(await this.claims.insurerForCoverage(dto), dto.nationalCode, dto.eventDate ? new Date(dto.eventDate) : null);
    return r ? { enabled: true, ...r } : { enabled: false };
  }

  /** کارگزاری opens a case for one of its بیمه‌گزار companies and uploads the documents for them. */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_FILE_ON_BEHALF)
  @Post('on-behalf')
  fileOnBehalf(@Body() dto: FileOnBehalfDto) {
    return this.claims.fileOnBehalf(dto);
  }

  /** All claims the caller participates in. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get()
  list(@Query('line') line?: string) {
    return this.claims.listMine(undefined, asLine(line)); // panel 1: one نوع بیمه‌نامه
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

  /** «روند سیناد» kartable: stage tabs with counts ({enabled:false} when the insurer doesn't run it). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('sinad/kartable')
  sinadKartable() {
    return this.claims.sinadKartable();
  }

  /** One kartable tab's cases («در انتظار ارزیابی اولیه» hands out the next batch when the last is done). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('sinad/kartable/:tab')
  sinadTab(@Param('tab') tab: string) {
    return this.claims.sinadTab(tab);
  }

  /** «اینجا» on «در انتظار ارزیابی اولیه»: give back my whole batch and get a new one. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post('sinad/release-batch')
  sinadReleaseBatch() {
    return this.claims.sinadReleaseBatch();
  }

  /** Branch colleagues to refer a case to («ارجاع»). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get('sinad/evaluators')
  sinadEvaluators() {
    return this.claims.sinadEvaluators();
  }

  /** «تخصیص پرونده‌ها» (insurer admin): evaluators with their load and settings, and every case at شعبه. */
  @Permissions(PERMISSIONS.CLAIM_OVERRIDE)
  @Get('sinad/allocation')
  sinadAllocation() {
    return this.claims.sinadAllocation();
  }

  /** Hand cases to an evaluator, or back to the pool (no userId). */
  @Permissions(PERMISSIONS.CLAIM_OVERRIDE)
  @Post('sinad/assign')
  sinadAssign(@Body() dto: SinadAssignDto) {
    return this.claims.sinadAssign(dto.claimIds, dto.userId ?? null);
  }

  /** One evaluator's batch size, paused flag and case types. */
  @Permissions(PERMISSIONS.CLAIM_OVERRIDE)
  @Put('sinad/evaluators/:userId')
  sinadEvaluatorSettings(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: EvaluatorSettingsDto) {
    return this.claims.sinadEvaluatorSettings(userId, dto);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/sinad')
  sinadCase(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.sinadCase(id);
  }

  /** «ارجاع به پزشک معتمد»: the insurer's trusted doctors. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get('sinad/doctors')
  sinadDoctors() {
    return this.claims.sinadDoctors();
  }

  /** The case's referrals to trusted doctors (with their answers). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/doctor-referrals')
  caseReferrals(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.caseReferrals(id);
  }

  /** «فرم ارفاقی»: ستاد's allowance for شعبه on this case. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/concessions')
  addConcession(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConcessionDto) {
    return this.claims.addConcession(id, dto.details);
  }

  /** Kartable operations: take, release, refer, later, resume, doctor-refer, doctor-exam, doctor-opinion, fraud-clean, fraud-flag, note. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/sinad/:op')
  sinadOp(@Param('id', ParseUUIDPipe) id: string, @Param('op') op: string, @Body() dto: SinadOpDto) {
    return this.claims.sinadOp(id, op, dto);
  }

  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  /** «دلایل رد مدارک» offered when rejecting a document: the insurer's list plus the caller org's own. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/reject-reasons')
  rejectReasons(@Param('id') id: string) {
    return this.claims.rejectReasons(id);
  }

  /** «ذینفع / وراث قانونی» of the case: kind + name and شبا of each (شبا masked without view:pii). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get(':id/heirs')
  heirs(@Param('id') id: string) {
    return this.claims.heirs(id);
  }

  @EntryAllowed() // panel 1 fills them while the case is at the بیمه‌گزار's desk (see canEditHeirs)
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Put(':id/heirs')
  setHeirs(@Param('id') id: string, @Body() dto: HeirsDto) {
    return this.claims.setHeirs(id, dto);
  }

  /** Panel 1 corrects the filing data until panel 2 starts on the case (checked in the service). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Put(':id/filing')
  editFiling(@Param('id') id: string, @Body() dto: FilingEditDto) {
    return this.claims.editFiling(id, dto);
  }

  /** کاربر ثبت removes the case they registered, until panel 2 starts on it (checked in the service). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Delete(':id/filing')
  withdrawFiling(@Param('id') id: string) {
    return this.claims.withdrawFiling(id);
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
  // panel 1 files them (claim:file); panel 2 uploads while it holds the case (claim:process — e.g. what a
  // return asked for, fixed at its own desk); the service checks which applies.
  @EntryAllowed()
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: docLimits }))
  uploadDocument(@Param('id') id: string, @Query('docCode') docCode: string, @Query('extra') extra: string | undefined, @UploadedFile() file: Express.Multer.File) {
    return this.claims.uploadDocument(id, file, docCode, extra === '1' || extra === 'true');
  }

  /** «حذف»: take back a file uploaded by mistake (not yet decided on by any desk). */
  @EntryAllowed()
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return this.claims.removeDocument(id, docId);
  }

  /** «پذیرش دستی»: a کارشناس accepts a file the AI refused. */
  @Permissions(PERMISSIONS.DOC_VERIFY)
  @Post(':id/documents/:docId/ai-accept')
  acceptAi(@Param('id') id: string, @Param('docId') docId: string) {
    return this.claims.acceptAiRefused(id, docId);
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

  /** Panel 1: send a case back after رفع نقص (the بیمه‌گزار's «ارسال», filed by the organization's staff). */
  @EntryOnly()
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post(':id/rectify')
  rectify(@Param('id') id: string, @Body() body: RectifyDto) {
    return this.claims.rectify(id, body?.note);
  }

  /** Take a workflow action offered in `workflow.actions` of GET /claims/:id (see workflow.ts). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/action')
  act(@Param('id') id: string, @Body() dto: ActionDto) {
    return this.claims.act(id, dto);
  }

  /** Relay / send / receive / return the original (physical) documents. */
  @EntryAllowed() // panel 1 only moves them at the بیمه‌گزار's desk (see physicalSeats)
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

/** پنل پزشک معتمد: the doctor sees only the cases referred to them, reads them and registers their part. */
@Controller('doctor')
export class DoctorController {
  constructor(private readonly claims: ClaimsService) {}

  @Permissions(PERMISSIONS.DOCTOR_OPINE)
  @Get('referrals')
  list() {
    return this.claims.doctorReferrals();
  }

  @Permissions(PERMISSIONS.DOCTOR_OPINE)
  @Get('referrals/:id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.doctorReferral(id);
  }

  @Permissions(PERMISSIONS.DOCTOR_OPINE)
  @Get('referrals/:id/documents/:docId/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.claims.doctorFile(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  @Permissions(PERMISSIONS.DOCTOR_OPINE)
  @Post('referrals/:id/answer')
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DoctorAnswerDto) {
    return this.claims.doctorAnswer(id, dto);
  }
}
