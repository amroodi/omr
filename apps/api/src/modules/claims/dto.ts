import { ClaimType, SalesChannel } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
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
  @IsISO8601()
  eventDate?: string; // date of the death/accident

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

const ACTION_KEYS = ['SUBMIT', 'FORWARD', 'REFER_COUNCIL', 'PAY_ORDER', 'RETURN', 'RETURN_DIRECT', 'DOWN_FORWARD', 'DOWN_DIRECT', 'MARK_PAID', 'REJECT_FINAL', 'REQUEST_PHYSICAL'] as const;

export class ActionDto {
  @IsIn(ACTION_KEYS as unknown as string[])
  action!: (typeof ACTION_KEYS)[number];

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsUUID()
  letterId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deficiencies?: string[];

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class LossNoticeDto {
  @IsString()
  @Length(1, 60)
  number!: string;

  @IsOptional()
  @IsISO8601()
  date?: string;
}

/** Multipart fields of a letter (the scan itself is the optional `file` part). */
export class LetterDto {
  @IsOptional()
  @IsString()
  @Length(0, 60)
  number?: string;

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  subject?: string;
}

const PHYSICAL_KEYS = ['PHYSICAL_SEND', 'PHYSICAL_RELAY', 'PHYSICAL_RECEIVE', 'PHYSICAL_RETURN'] as const;

export class PhysicalDto {
  @IsIn(PHYSICAL_KEYS as unknown as string[])
  action!: (typeof PHYSICAL_KEYS)[number];

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  trackingNo?: string;

  @IsOptional()
  @IsUUID()
  letterId?: string;
}
