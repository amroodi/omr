import { ClaimType, SalesChannel } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class FileClaimDto {
  @IsUUID()
  insurerTenantId!: string;

  @IsEnum(SalesChannel)
  channel!: SalesChannel;

  @IsOptional()
  @IsUUID()
  brokerTenantId?: string;

  @IsOptional()
  @IsUUID()
  sellingBranchId?: string;

  @IsOptional()
  @IsEnum(ClaimType)
  claimType?: ClaimType;

  @IsOptional()
  @IsString()
  policyNumber?: string;

  @IsNumberString()
  claimedAmount!: string;

  @IsString()
  @Length(2, 120)
  deceasedFullName!: string;

  @IsString()
  @Length(8, 12)
  deceasedNationalCode!: string;

  @IsOptional()
  @IsUUID()
  policyHolderId?: string;
}

export class DecisionDto {
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  deficiencies?: string[];
}
