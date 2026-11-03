import { InsuranceLine } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { BENEFICIARY_KINDS, HeirDto } from '../claims/dto';
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
  // نوع بیمه‌نامه chosen on the panel-1 login
  @IsOptional()
  @IsEnum(InsuranceLine)
  line?: InsuranceLine;

  // The insurer is NOT chosen by the بیمه‌گزار — it comes from the brokerage's contract for their company.
  @IsOptional()
  @IsISO8601()
  deceasedBirthDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  claimType?: string;

  @IsOptional()
  @IsISO8601()
  eventDate?: string;

  @IsString()
  @Length(2, 120)
  deceasedFullName!: string;

  @IsString()
  @Length(8, 12)
  deceasedNationalCode!: string;

  // نوع بیمه‌شده: the subject above is the main insured, or a dependent of the main insured named here.
  @IsOptional()
  @IsIn(['MAIN', 'SPOUSE', 'CHILD'])
  insuredRelation?: 'MAIN' | 'SPOUSE' | 'CHILD';

  @IsOptional()
  @IsString()
  @Length(2, 120)
  mainInsuredName?: string;

  @IsOptional()
  @IsString()
  @Length(8, 12)
  mainInsuredNationalCode?: string;

  // «broker» login only: the company the claim is filed for.
  @IsOptional()
  @IsUUID()
  companyId?: string;

  // The بیمه‌نامه (عمر or حوادث contract of their company) the claim is filed under.
  @IsOptional()
  @IsUUID()
  contractId?: string;

  // An insurer's نماینده بیمه: the policy number (a company's contract supplies it otherwise).
  @IsOptional()
  @IsString()
  @Length(1, 60)
  policyNumber?: string;

  // «اعلام خسارت به»: the desk the case starts on (allowed by the «اعلام خسارت» rules).
  @IsOptional()
  @IsIn(['POLICYHOLDER', 'BROKER', 'BRANCH', 'HQ', 'COUNCIL'])
  startStage?: 'POLICYHOLDER' | 'BROKER' | 'BRANCH' | 'HQ' | 'COUNCIL';

  // علت خسارت: the ticked causes and/or typed text.
  @IsOptional()
  @IsString()
  @Length(0, 1500)
  causeOfDeath?: string;

  // «ذینفع / وراث قانونی» named on the deceased's form (the form itself is uploaded right after filing).
  @IsOptional()
  @IsIn(BENEFICIARY_KINDS as unknown as string[])
  beneficiaryType?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => HeirDto)
  heirs?: HeirDto[];

  // بیمه‌گزار can't know the exact amount/policy number; free-text details instead.
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;
}

/** نماینده panel login: کد ملی + password. */
export class RepresentativeLoginDto {
  @ToAsciiDigits()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'کد ملی باید ۱۰ رقم باشد' })
  nationalCode!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class CoverageCheckDto {
  @IsUUID()
  contractId!: string;

  @ToAsciiDigits()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'کد ملی باید ۱۰ رقم باشد' })
  nationalCode!: string;
}
