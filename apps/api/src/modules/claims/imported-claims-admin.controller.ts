import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { SuperAdminOnly } from '../../common/rbac/decorators';
import { ClaimsService } from './claims.service';

/** Delete the listed imported cases (`ids`), or — with `all` — every imported case matching `tenantId` + `q`. */
class PurgeImportedDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20000) @IsUUID('all', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsString() @Length(0, 100) q?: string;
}

/** Super admin: cases brought in by «ورود دسته‌ای» — list and permanent single / batch / bulk delete. */
@SuperAdminOnly()
@Controller('admin/imported-claims')
export class ImportedClaimsAdminController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string, @Query('q') q?: string) {
    return this.claims.listImported(tenantId || undefined, q);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.claims.purgeImported([id]);
  }

  @Post('delete')
  async removeMany(@Body() dto: PurgeImportedDto) {
    if (dto.all) return this.claims.purgeImported((await this.claims.listImported(dto.tenantId, dto.q)).map((c) => c.id));
    if (!dto.ids?.length) throw new BadRequestException('هیچ پرونده‌ای انتخاب نشده است');
    return this.claims.purgeImported(dto.ids);
  }
}
