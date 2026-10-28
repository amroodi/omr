import { ClaimType } from '@prisma/client';
import { IsEnum, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ToAsciiDigits } from '../../common/validation/to-ascii.decorator';

export class CustomerRequestOtpDto {
  @ToAsciiDigits()
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @ToAsciiDigits()
  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}

export class CustomerVerifyOtpDto extends CustomerRequestOtpDto {
  @ToAsciiDigits()
  @IsString()
  @Length(4, 8)
  code!: string;
}

export class CustomerSignupDto {
  @IsString()
  @Length(2, 40)
  tenantSlug!: string;

  @ToAsciiDigits()
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @ToAsciiDigits()
  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;
}

export class CustomerSignupVerifyDto extends CustomerSignupDto {
  @ToAsciiDigits()
  @IsString()
  @Length(4, 8)
  code!: string;
}

/** بیمه‌گزار panel login: «کد بیمه‌گزار» + password. */
export class CustomerCompanyLoginDto {
  @ToAsciiDigits()
  @IsString()
  @Length(1, 40)
  code!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class CustomerChangePasswordDto {
  @IsString()
  @Length(1, 200)
  current!: string;

  @IsString()
  @Length(8, 200)
  next!: string;
}

/** A بیمه‌گزار files their own claim; channel/معرف/policyHolder are derived from their session. */
export class CustomerFileClaimDto {
  // The insurer is NOT chosen by the بیمه‌گزار — it comes from the brokerage's contract for their company.
  @IsOptional()
  @IsISO8601()
  deceasedBirthDate?: string;

  @IsOptional()
  @IsEnum(ClaimType)
  claimType?: ClaimType;

  @IsOptional()
  @IsISO8601()
  eventDate?: string;

  @IsString()
  @Length(2, 120)
  deceasedFullName!: string;

  @IsString()
  @Length(8, 12)
  deceasedNationalCode!: string;

  // «broker» login only: the company the claim is filed for.
  @IsOptional()
  @IsUUID()
  companyId?: string;

  // The بیمه‌نامه (عمر or حوادث contract of their company) the claim is filed under.
  @IsOptional()
  @IsUUID()
  contractId?: string;

  // «اعلام خسارت به»: the desk the case starts on (allowed by the «اعلام خسارت» rules).
  @IsOptional()
  @IsIn(['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'])
  startStage?: 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';

  // علت فوت as the بیمه‌گزار knows it (free text, e.g. «ایست قلبی»).
  @IsOptional()
  @IsString()
  @Length(0, 300)
  causeOfDeath?: string;

  // بیمه‌گزار can't know the exact amount/policy number; free-text details instead.
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;
}
