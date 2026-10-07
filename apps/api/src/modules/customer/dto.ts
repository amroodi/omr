import { ClaimType } from '@prisma/client';
import { IsEnum, IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CustomerRequestOtpDto {
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}

export class CustomerVerifyOtpDto extends CustomerRequestOtpDto {
  @IsString()
  @Length(4, 8)
  code!: string;
}

export class CustomerSignupDto {
  @IsString()
  @Length(2, 40)
  tenantSlug!: string;

  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;
}

export class CustomerSignupVerifyDto extends CustomerSignupDto {
  @IsString()
  @Length(4, 8)
  code!: string;
}

/** A بیمه‌گزار files their own claim; channel/معرف/policyHolder are derived from their session. */
export class CustomerFileClaimDto {
  @IsUUID()
  insurerTenantId!: string;

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

  @IsNumberString()
  claimedAmount!: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  policyNumber?: string;
}
