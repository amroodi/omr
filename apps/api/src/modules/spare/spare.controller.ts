import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BrokerPanelOnly, Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { SpareService } from './spare.service';

const docLimits = { fileSize: 15 * 1024 * 1024 };
const importLimits = { fileSize: 5 * 1024 * 1024 };

class CreateSpareDto {
  @IsString() @Length(2, 40) claimType!: string;
}
class SpareFieldDto {
  @IsString() @Length(0, 4000) value!: string;
}
class ShareDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(1000) @IsUUID(undefined, { each: true }) ids!: string[];
  @IsOptional() @IsUUID() companyId?: string | null;
}

/** «میز کار مستقل» of a brokerage. Off (Super Admin) or without `spare:work`, none of this answers. */
@BrokerPanelOnly()
@Permissions(PERMISSIONS.SPARE_WORK)
@Controller('spare')
export class SpareController {
  constructor(private readonly spare: SpareService) {}

  @Get('options')
  options() { return this.spare.options(); }

  @Get()
  list(@Query('nationalCode') nationalCode?: string, @Query('name') name?: string, @Query('claimType') claimType?: string, @Query('companyId') companyId?: string) {
    return this.spare.list({ nationalCode, name, claimType, companyId });
  }

  @Post()
  create(@Body() dto: CreateSpareDto) { return this.spare.create(dto.claimType); }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: importLimits }))
  importPreview(@UploadedFile() file: Express.Multer.File) { return this.spare.importPreview(file); }

  @Post('import/commit')
  @UseInterceptors(FileInterceptor('file', { limits: importLimits }))
  importCommit(@UploadedFile() file: Express.Multer.File, @Query('claimType') claimType: string) { return this.spare.importCommit(file, claimType); }

  @Post('share')
  share(@Body() dto: ShareDto) { return this.spare.share(dto.ids, dto.companyId ?? null); }

  @Get(':id')
  get(@Param('id') id: string) { return this.spare.get(id); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.spare.remove(id); }

  @Get(':id/fields')
  fields(@Param('id') id: string) { return this.spare.fields(id); }

  @Put(':id/fields/:key')
  setField(@Param('id') id: string, @Param('key') key: string, @Body() dto: SpareFieldDto) { return this.spare.setField(id, key, dto.value); }

  @Get(':id/checklist')
  checklist(@Param('id') id: string) { return this.spare.checklist(id); }

  @Get(':id/documents')
  documents(@Param('id') id: string) { return this.spare.documents(id); }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: docLimits }))
  upload(@Param('id') id: string, @Query('docCode') docCode: string, @UploadedFile() file: Express.Multer.File) { return this.spare.upload(id, file, docCode); }

  @Get(':id/documents/:docId/file')
  async file(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.spare.file(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) { return this.spare.removeDocument(id, docId); }
}

/** What the operator chose to share with this بیمه‌گزار company: read-only. */
@Controller('customer/shared-cases')
export class SpareSharedController {
  constructor(private readonly spare: SpareService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  list() { return this.spare.sharedList(); }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  detail(@Param('id') id: string) { return this.spare.sharedDetail(id); }

  @UseGuards(JwtAuthGuard)
  @Get(':id/documents/:docId/file')
  async file(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const { buffer, mimeType, fileName } = await this.spare.sharedFile(id, docId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }
}
