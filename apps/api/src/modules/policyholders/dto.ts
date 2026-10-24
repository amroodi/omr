import { IsBoolean, IsEmail, IsISO8601, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class CompanyDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 400)
  address?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  website?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  contactName?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ContractDto {
  @IsOptional()
  @IsUUID()
  insurerTenantId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  policyNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsISO8601()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsISO8601()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 400)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PartnerDto {
  @IsBoolean()
  enabled!: boolean;
}

export class AssignCompanyDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  companyId!: string | null;
}
