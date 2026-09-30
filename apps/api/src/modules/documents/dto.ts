import { DocumentKind, VerificationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class VerifyDocumentDto {
  @IsEnum(VerificationStatus)
  status!: VerificationStatus;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

export class UploadDocumentDto {
  @IsUUID()
  caseId!: string;

  @IsEnum(DocumentKind)
  kind!: DocumentKind;
}
