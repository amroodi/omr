import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ClaimPartyType, FieldGroup, FieldType } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ClaimFieldDefsService } from './claim-field-defs.service';

class CreateFieldDto {
  @IsString() @Length(2, 60) key!: string;
  @IsString() @Length(1, 200) label!: string;
  @IsOptional() @IsEnum(FieldType) type?: FieldType;
  @IsOptional() @IsEnum(FieldGroup) group?: FieldGroup;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsArray() @IsEnum(ClaimPartyType, { each: true }) editableBy?: ClaimPartyType[];
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() required?: boolean;
}
class UpdateFieldDto {
  @IsOptional() @IsString() @Length(1, 200) label?: string;
  @IsOptional() @IsEnum(FieldType) type?: FieldType;
  @IsOptional() @IsEnum(FieldGroup) group?: FieldGroup;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsEnum(ClaimPartyType, { each: true }) editableBy?: ClaimPartyType[];
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Insurer configuration of the claim-field catalog. */
@Controller('claim-fields')
export class ClaimFieldsController {
  constructor(private readonly defs: ClaimFieldDefsService) {}

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Get()
  list() {
    return this.defs.list();
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Post()
  create(@Body() dto: CreateFieldDto) {
    return this.defs.create(dto);
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Post('seed-defaults')
  seed() {
    return this.defs.seedDefaults();
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.defs.update(id, dto);
  }

  @Permissions(PERMISSIONS.LEVEL_MANAGE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.defs.remove(id);
  }
}
