import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CasesService } from './cases.service';
import { ListCasesDto, UpdateCaseStatusDto } from './dto';

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Permissions(PERMISSIONS.CASE_READ)
  @Get()
  list(@Query() query: ListCasesDto) {
    return this.cases.list(query);
  }

  @Permissions(PERMISSIONS.CASE_READ)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.cases.get(id);
  }

  @Permissions(PERMISSIONS.CASE_EDIT)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCaseStatusDto) {
    return this.cases.updateStatus(id, dto.status);
  }
}
