import { ClaimType, SalesChannel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  ValidateNested,
} from 'class-validator';
import { ToAsciiDigits } from '../../common/validation/to-ascii.decorator';

export const BENEFICIARY_KINDS = ['ذینفع قانونی', 'وراث قانونی'] as const;

/** One ذینفع / وارث from the deceased's beneficiary (inheritance) form: name + شبا. */
export class HeirDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ToAsciiDigits()
  @IsString()
  @Length(24, 34)
  iban!: string; // checked (IR + 24 digits, mod-97) in the service
}

/** «ذینفع / وراث قانونی» of a case: the kind and the people named on the form. */
export class HeirsDto {
  @IsOptional()
  @IsIn(BENEFICIARY_KINDS as unknown as string[])
  beneficiaryType?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => HeirDto)
  heirs!: HeirDto[];
}

export class FileClaimDto {
  // Omitted when a بیمه‌گزار company is given: its contract for the date of death decides the insurer.
  @IsOptional()
  @IsUUID()
  insurerTenantId?: string;

  @IsOptional()
  @IsUUID()
  policyholderCompanyId?: string;

  @IsOptional()
  @IsISO8601()
  deceasedBirthDate?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

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

  // «اعلام خسارت به»: the desk the case starts on (allowed by the org's «اعلام خسارت» rules).
  @IsOptional()
  @IsIn(['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'])
  startStage?: 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(BENEFICIARY_KINDS as unknown as string[])
  beneficiaryType?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => HeirDto)
  heirs?: HeirDto[];
}

/** کارگزاری files a case as a بیمه‌گزار company (claim:file-on-behalf). The insurer comes from its contract. */
export class FileOnBehalfDto {
  @IsUUID()
  policyholderCompanyId!: string;

  @IsOptional()
  @IsUUID()
  policyHolderId?: string; // a representative account of that company, so it also sees the case in its panel

  @IsOptional()
  @IsEnum(ClaimType)
  claimType?: ClaimType;

  @IsISO8601()
  eventDate!: string;

  @IsOptional()
  @IsISO8601()
  deceasedBirthDate?: string;

  @IsString()
  @Length(2, 120)
  deceasedFullName!: string;

  @IsString()
  @Length(8, 12)
  deceasedNationalCode!: string;

  @IsOptional()
  @IsNumberString()
  claimedAmount?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsIn(['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'])
  startStage?: 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';

  @IsOptional()
  @IsIn(BENEFICIARY_KINDS as unknown as string[])
  beneficiaryType?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => HeirDto)
  heirs?: HeirDto[];
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
