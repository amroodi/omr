import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DocAppliesTo } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { RequiredDocsService } from './required-docs.service';

class CreateDocDto {
  @IsString() @Length(2, 60) code!: string;
  @IsString() @Length(2, 200) label!: string;
  @IsOptional() @IsEnum(DocAppliesTo) appliesTo?: DocAppliesTo;
  @IsOptional() @IsInt() @Min(0) order?: number;
}
class UpdateDocDto {
  @IsOptional() @IsString() @Length(2, 200) label?: string;
  @IsOptional() @IsEnum(DocAppliesTo) appliesTo?: DocAppliesTo;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('required-documents')
export class RequiredDocsController {
  constructor(private readonly svc: RequiredDocsService) {}

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Get()
  list() {
    return this.svc.list();
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Post()
  create(@Body() dto: CreateDocDto) {
    return this.svc.create(dto);
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Post('seed-defaults')
  seed() {
    return this.svc.seedDefaults();
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocDto) {
    return this.svc.update(id, dto);
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
