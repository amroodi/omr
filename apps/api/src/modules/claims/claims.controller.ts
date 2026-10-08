import {
  Body,
  Controller,
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
import { DecisionDto, FileClaimDto } from './dto';

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

  /** All claims the caller participates in. */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get()
  list() {
    return this.claims.listMine();
  }

  /** The caller's action queue (claims awaiting their step). */
  @Permissions(PERMISSIONS.CLAIM_READ)
  @Get('queue')
  queue() {
    return this.claims.queue();
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
  setField(@Param('id') id: string, @Param('key') key: string, @Body() body: { value: string }) {
    return this.fields.setValue(id, key, body?.value ?? '');
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

  /** معرف forwards / insurer level endorses (engine routes by authority ceiling). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/endorse')
  endorse(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'ENDORSE', dto);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/return-incomplete')
  returnIncomplete(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'RETURN_INCOMPLETE', dto);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.decide(id, 'REJECT', dto);
  }

  /** بیمه‌گزار resolves deficiencies and resubmits (restarts the chain). */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post(':id/rectify')
  rectify(@Param('id') id: string, @Body() dto: DecisionDto) {
    return this.claims.rectify(id, dto.note);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Post(':id/pay')
  pay(@Param('id') id: string) {
    return this.claims.markPaid(id);
  }
}
