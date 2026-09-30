import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, DocumentKind, VerificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { FieldCryptoService } from '../../common/crypto/field-crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getContext, getTenantIdOrThrow } from '../../common/tenant/tenant-context';
import { branchWhere } from '../../common/tenant/branch-scope';
import { OcrService } from '../../integrations/ocr/ocr.service';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly crypto: FieldCryptoService,
    private readonly ocr: OcrService,
  ) {}

  /** Upload a document to a case: validate, encrypt-at-rest, and queue for assessment. */
  async upload(
    file: Express.Multer.File,
    caseId: string,
    kind: DocumentKind,
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer?.length) throw new BadRequestException('فایلی دریافت نشد');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('فقط فایل‌های PDF، JPG و PNG مجاز است');
    }
    const tenantId = getTenantIdOrThrow();
    // Confirm the case belongs to this tenant (and the caller's branch).
    const kase = await this.prisma.scoped.case.findFirst({ where: { id: caseId, ...branchWhere() }, select: { id: true } });
    if (!kase) throw new NotFoundException('پرونده یافت نشد');

    const storageKey = await this.storage.save(tenantId, file.buffer);
    const doc = await this.prisma.scoped.document.create({
      data: {
        tenantId,
        caseId,
        kind,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        uploadedBy: getContext()?.actorId ?? null,
        verificationStatus: VerificationStatus.PENDING,
      },
      select: this.publicSelect(),
    });
    await this.audit.record({ action: AuditAction.UPLOAD, targetType: 'Document', targetId: doc.id, metadata: { kind, fileName: file.originalname } });
    return doc;
  }

  /** Return the decrypted file bytes for download (authorization enforced by the controller). */
  async getFile(id: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const doc = await this.prisma.scoped.document.findFirst({
      where: { id },
      select: { storageKey: true, mimeType: true, fileName: true },
    });
    if (!doc) throw new NotFoundException('سند یافت نشد');
    const buffer = await this.storage.read(doc.storageKey);
    await this.audit.record({ action: AuditAction.VIEW, targetType: 'DocumentFile', targetId: id });
    return { buffer, mimeType: doc.mimeType, fileName: doc.fileName };
  }

  /** Run OCR on a stored document and persist encrypted extracted text/fields. */
  async runOcr(id: string): Promise<Record<string, unknown>> {
    const doc = await this.prisma.scoped.document.findFirst({
      where: { id },
      select: { id: true, storageKey: true, mimeType: true, kind: true },
    });
    if (!doc) throw new NotFoundException('سند یافت نشد');

    await this.prisma.scoped.document.update({ where: { id }, data: { ocrStatus: 'processing' } });
    try {
      const buffer = await this.storage.read(doc.storageKey);
      const result = await this.ocr.extract(buffer, doc.mimeType, doc.kind);
      await this.prisma.scoped.document.update({
        where: { id },
        data: {
          ocrStatus: 'done',
          ocrText: result.text ? this.crypto.encrypt(result.text) : null,
          ocrFields: Object.keys(result.fields).length ? this.crypto.encrypt(JSON.stringify(result.fields)) : null,
        },
      });
      await this.audit.record({ action: AuditAction.EDIT, targetType: 'DocumentOCR', targetId: id, metadata: { engine: result.engine } });
      return { id, ocrStatus: 'done', engine: result.engine, extractedFields: Object.keys(result.fields) };
    } catch (e) {
      await this.prisma.scoped.document.update({ where: { id }, data: { ocrStatus: 'failed' } });
      throw e;
    }
  }

  listByCase(caseId: string) {
    return this.prisma.scoped.document.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      select: this.publicSelect(),
    });
  }

  /** The assessor's work queue: documents awaiting authenticity assessment. */
  pendingQueue() {
    return this.prisma.scoped.document.findMany({
      where: { verificationStatus: VerificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: this.publicSelect(),
    });
  }

  /** Record an assessor's authenticity/integrity decision on a document. */
  async verify(id: string, status: VerificationStatus, note?: string) {
    const doc = await this.prisma.scoped.document.findFirst({ where: { id } });
    if (!doc) throw new NotFoundException('سند یافت نشد');

    const assessorId = getContext()?.actorId ?? null;
    const updated = await this.prisma.scoped.document.update({
      where: { id },
      data: {
        verificationStatus: status,
        verifiedById: assessorId,
        verifiedAt: new Date(),
        verificationNote: note ?? null,
      },
      select: this.publicSelect(),
    });

    await this.audit.record({
      action: AuditAction.EDIT,
      targetType: 'Document',
      targetId: id,
      metadata: { verificationStatus: status, note },
    });
    return updated;
  }

  private publicSelect() {
    return {
      id: true,
      kind: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      ocrStatus: true,
      verificationStatus: true,
      verifiedById: true,
      verifiedAt: true,
      verificationNote: true,
      caseId: true,
      createdAt: true,
    } as const;
  }
}
