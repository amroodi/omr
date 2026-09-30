import { Controller, Get, Query, Res } from '@nestjs/common';
import { CaseStatus } from '@prisma/client';
import { Response } from 'express';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ExportsService } from './exports.service';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Permissions(PERMISSIONS.EXPORT_LIST)
  @Get('cases.xlsx')
  async xlsx(@Query('status') status: CaseStatus | undefined, @Res() res: Response) {
    await this.exports.casesXlsx(res, status);
  }

  @Permissions(PERMISSIONS.EXPORT_LIST)
  @Get('cases.print')
  async print(@Query('status') status: CaseStatus | undefined, @Res() res: Response) {
    const html = await this.exports.casesPrintHtml(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
