import { Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Public } from '../../common/rbac/decorators';
import { ClaimsService } from './claims.service';

/**
 * The re-upload link sent by SMS when the AI refused files («بارگذاری دوبارهٔ مدارک»). No login: the
 * token itself opens ONE case, shows only its refused documents and accepts files only for them.
 */
@Public()
@Controller('upload-link')
export class UploadLinkController {
  constructor(private readonly claims: ClaimsService) {}

  @Get(':token')
  info(@Param('token') token: string, @Req() req: Request) {
    return this.claims.uploadLinkInfo(token, req.ip ?? '');
  }

  @Post(':token/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(@Param('token') token: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    return this.claims.uploadViaLink(token, docCode, file, req.ip ?? '');
  }
}
