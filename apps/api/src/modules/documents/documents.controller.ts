import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { VerifyDocumentDto } from './dto';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Permissions(PERMISSIONS.DOC_READ)
  @Get()
  listByCase(@Query('caseId') caseId: string) {
    return this.documents.listByCase(caseId);
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
