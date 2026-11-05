import { INSURED_RELATIONS, InsuredRelation } from './workflow';
import { SalesChannel } from '@prisma/client';
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
  Matches,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ToAsciiDigits } from '../../common/validation/to-ascii.decorator';
import { KIND_CODE } from '../../common/kinds';

export const BENEFICIARY_KINDS = ['ذینفع قانونی', 'وراث قانونی'] as const;

/** One ذینفع / وارث from the beneficiary form: name, کد ملی + شبا. */
export class HeirDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsOptional()
  @ToAsciiDigits()
  @IsString()
  @Length(10, 10)
  nationalCode?: string; // checked in the service; older rows have none

  @ToAsciiDigits()
  @IsString()
  @Length(24, 34)
  iban!: string; // checked (IR + 24 digits, mod-97) in the service

  @IsOptional()
  @IsString()
  @Length(0, 40)
  relation?: string; // نسبت with the main insured

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sharePercent?: number; // سهم (٪) on the form, when it gives one
}

/** Panel 1 corrects what it filed, until panel 2 starts on the case. Only the fields sent change. */
export class FilingEditDto {
  @IsOptional() @IsString() @Length(2, 120) deceasedFullName?: string;
  @IsOptional() @ToAsciiDigits() @IsString() @Matches(/^\d{10}$/, { message: 'کد ملی باید ۱۰ رقم باشد' }) deceasedNationalCode?: string;
  @IsOptional() @IsISO8601() eventDate?: string;
  // '' clears it
  @IsOptional() @IsString() deceasedBirthDate?: string;
  @IsOptional() @IsString() @Length(0, 300) causeOfDeath?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
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
  // سرمایه فوت / سرمایه حادثه (rials), optional — not every filer knows them
  @IsOptional() @IsString() @Matches(/^\d{0,18}$/) deathCapital?: string;
  @IsOptional() @IsString() @Matches(/^\d{0,18}$/) accidentCapital?: string;
  // «علت خسارت» (ticked items and/or typed text); Model View may make it required
  @IsOptional()
  @IsString()
  @Length(0, 1500)
  causeOfDeath?: string;

  // نوع بیمه‌نامه chosen on the panel-1 login
  @IsOptional()
  @IsString()
  @Matches(KIND_CODE)
  line?: string;

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
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  claimType?: string;

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
  // سرمایه فوت / سرمایه حادثه (rials), optional — not every filer knows them
  @IsOptional() @IsString() @Matches(/^\d{0,18}$/) deathCapital?: string;
  @IsOptional() @IsString() @Matches(/^\d{0,18}$/) accidentCapital?: string;
  // نوع بیمه‌نامه chosen on the panel-1 login
  @IsOptional()
  @IsString()
  @Matches(KIND_CODE)
  line?: string;

  @IsUUID()
  policyholderCompanyId!: string;

  // The بیمه‌نامه picked on the form (as on the بیمه‌گزار panel); else the one in force on the event date.
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsIn(INSURED_RELATIONS as unknown as string[])
  insuredRelation?: InsuredRelation;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  mainInsuredName?: string;

  @IsOptional()
  @IsString()
  @Length(8, 12)
  mainInsuredNationalCode?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1500)
  causeOfDeath?: string;

  @IsOptional()
  @IsUUID()
  policyHolderId?: string; // a representative account of that company, so it also sees the case in its panel

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  claimType?: string;

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

/** Panel 1 «ارسال» after رفع نقص: an optional note to the desk. */
export class RectifyDto {
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}
