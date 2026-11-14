import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ToAsciiDigits } from '../../common/validation/to-ascii.decorator';

// National ID: 10 digits. Phone: Iranian mobile. Persian/Arabic digits are normalized to ASCII.
export class RequestOtpDto {
  @ToAsciiDigits()
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @ToAsciiDigits()
  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;

  // The بیمه‌گزار company the deceased worked for (picked first on the استعلام form).
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class InquiryMessageDto {
  @IsString()
  @Length(3, 2000)
  message!: string;

  // A password login has no verified mobile: the one the answer is texted to.
  @IsOptional()
  @ToAsciiDigits()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone?: string;

  // Which of the looked-up کد ملی's cases the question is about (the token must grant it).
  @IsOptional()
  @IsUUID()
  claimId?: string;
}

/** Panel 3 with the phone field off: کد ملی + password (default: the کد ملی). */
export class PasswordLoginDto {
  @ToAsciiDigits()
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @IsString()
  @Length(1, 128)
  password!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class InquiryPasswordDto {
  @IsString()
  @Length(1, 128)
  current!: string;

  @IsString()
  @Length(6, 128)
  next!: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @ToAsciiDigits()
  @IsString()
  @Length(4, 8)
  code!: string;
}
