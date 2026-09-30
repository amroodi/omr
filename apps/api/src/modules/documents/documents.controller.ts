import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { UploadDocumentDto, VerifyDocumentDto } from './dto';
import { DocumentsService } from './documents.service';

const uploadLimits = { fileSize: 15 * 1024 * 1024 }; // 15 MB

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Upload a document to a case (PDF/JPG/PNG). Enters the assessor queue as PENDING. */
  @Permissions(PERMISSIONS.DOC_UPLOAD)
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: uploadLimits }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocumentDto) {
    return this.documents.upload(file, dto.caseId, dto.kind);
  }

  @Permissions(PERMISSIONS.DOC_READ)
  @Get()
  listByCase(@Query('caseId') caseId: string) {
    return this.documents.listByCase(caseId);
  }

  /** Download the decrypted file. */
  @Permissions(PERMISSIONS.DOC_READ)
  @Get(':id/file')
  async file(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.documents.getFile(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  /** Run OCR extraction on a stored document. */
  @Permissions(PERMISSIONS.OCR_RUN)
  @Post(':id/ocr')
  runOcr(@Param('id') id: string) {
    return this.documents.runOcr(id);
  }

  /** Assessor work queue — documents awaiting authenticity assessment. */
  @Permissions(PERMISSIONS.DOC_VERIFY)
  @Get('verification-queue')
  queue() {
    return this.documents.pendingQueue();
  }

  /** Assessor records an authenticity/integrity decision. */
  @Permissions(PERMISSIONS.DOC_VERIFY)
  @Post(':id/verify')
  verify(@Param('id') id: string, @Body() dto: VerifyDocumentDto) {
    return this.documents.verify(id, dto.status, dto.note);
  }
}
