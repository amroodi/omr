import { TenantKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, Length, Matches } from 'class-validator';

export class ProvisionTenantDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsEnum(TenantKind)
  kind?: TenantKind; // INSURER | BROKER (default BROKER)

  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'slug must be lowercase letters, digits, hyphens' })
  slug!: string;

  @IsString()
  @Length(3, 64)
  adminUsername!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  adminDisplayName?: string;

  @IsOptional()
  @IsString()
  @Length(8, 128)
  adminPassword?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  contactHeader?: string;
}

export class SetTenantActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(TenantKind)
  kind?: TenantKind;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'slug must be lowercase letters, digits, hyphens' })
  slug?: string;
}

export class ResetAdminDto {
  @IsOptional()
  @IsString()
  @Length(3, 64)
  username?: string;
}

export class SetPartnerDto {
  @IsString()
  insurerTenantId!: string;

  @IsBoolean()
  enabled!: boolean;
}
