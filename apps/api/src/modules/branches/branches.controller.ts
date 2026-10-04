import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { BranchesService } from './branches.service';

class CreateBranchDto {
  @IsString() @Length(2, 120) name!: string;
  @IsString() @Length(1, 40) code!: string;
}

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Permissions(PERMISSIONS.BRANCH_MANAGE)
  @Get()
  list() {
    return this.branches.list();
  }

  @Permissions(PERMISSIONS.BRANCH_MANAGE)
  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto.name, dto.code);
  }

  @Permissions(PERMISSIONS.BRANCH_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.branches.remove(id);
  }
}
