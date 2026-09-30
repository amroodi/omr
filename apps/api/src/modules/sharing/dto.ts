import { SharingScope } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class GrantShareDto {
  @IsUUID()
  partnerTenantId!: string;

  @IsEnum(SharingScope)
  scope!: SharingScope;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
