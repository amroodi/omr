import { Controller, Get, Param, Query, Res } from '@nestjs/common';
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

  /** Bulk death-claim list export (honors status + search filters). Audit-logged. */
  @Permissions(PERMISSIONS.EXPORT_LIST)
  @Get('claims.xlsx')
  async claimsXlsx(@Query('status') status: string | undefined, @Query('q') q: string | undefined, @Res() res: Response) {
    await this.exports.claimsXlsx(res, status, q);
  }

  /** Single death-claim export (all fields). Audit-logged. */
  @Permissions(PERMISSIONS.EXPORT_LIST)
  @Get('claim/:id.xlsx')
  async claimXlsx(@Param('id') id: string, @Res() res: Response) {
    await this.exports.claimXlsx(res, id);
  }
}
