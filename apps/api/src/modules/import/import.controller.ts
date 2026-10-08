import {
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../../common/rbac/decorators';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { ImportService } from './import.service';

const limits = { fileSize: 5 * 1024 * 1024 }; // 5 MB

@Controller('import')
export class ImportController {
  constructor(private readonly importer: ImportService) {}

  /** Upload CSV/XLSX and get a validated preview (no data written). */
  @Permissions(PERMISSIONS.IMPORT_BATCH)
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits }))
  preview(@UploadedFile() file: Express.Multer.File) {
    return this.importer.preview(file);
  }

  /** Upload CSV/XLSX and commit valid rows (settled rows → claims, the rest → insured parties). */
  @Permissions(PERMISSIONS.IMPORT_BATCH)
  @Post('commit')
  @UseInterceptors(FileInterceptor('file', { limits }))
  commit(@UploadedFile() file: Express.Multer.File, @Query('insurerTenantId') insurerTenantId?: string) {
    return this.importer.commit(file, insurerTenantId);
  }
}
