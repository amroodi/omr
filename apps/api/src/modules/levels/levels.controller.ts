import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApprovalLevelKind } from '@prisma/client';
import { IsEnum, IsInt, IsNumberString, IsOptional, IsString, Length, Min } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { LevelsService } from './levels.service';

class CreateLevelDto {
  @IsString() @Length(2, 80) name!: string;
  @IsInt() @Min(1) order!: number;
  @IsOptional() @IsNumberString() ceiling?: string; // omit = unlimited
  @IsOptional() @IsEnum(ApprovalLevelKind) kind?: ApprovalLevelKind;
}

@Controller('approval-levels')
export class LevelsController {
  constructor(private readonly levels: LevelsService) {}

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Get()
  list() {
    return this.levels.list();
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Post()
  create(@Body() dto: CreateLevelDto) {
    return this.levels.create(dto);
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.levels.remove(id);
  }
}
