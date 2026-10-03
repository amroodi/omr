import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ClaimsService } from './claims.service';
import { DecisionDto, FileClaimDto } from './dto';

const docLimits = { fileSize: 15 * 1024 * 1024 };

@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  /** File a death claim (بیمه‌گزار / broker on their behalf). */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post()
  file(@Body() dto: FileClaimDto) {
    return this.claims.file(dto);
  }

  /** All claims the caller participates in. */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get()
  list() {
    return this.claims.listMine();
  }

  /** The caller's action queue (claims awaiting their step). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get('queue')
  queue() {
    return this.claims.queue();
  }

  /** Active insurers to file a claim against. */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Get('insurers')
  insurers() {
    return this.claims.listInsurers();
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  /** Required-document checklist (filtered by the claim's cause of death). */
  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get(':id/checklist')
  checklist(@Param('id') id: string) {
    return this.claims.checklist(id);
  }

  @Permissions(PERMISSIONS.CLAIM_PROCESS)
  @Get(':id/documents')
  documents(@Param('id') id: string) {
    return this.claims.listDocuments(id);
  }

  /** Upload a document to the claim, tagged with the required-document code it satisfies. */
  @Permissions(PERMISSIONS.CLAIM_FILE)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: docLimits }))
  uploadDocument(@Param('id') id: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File) {
    return this.claims.uploadDocument(id, file, docCode);
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
