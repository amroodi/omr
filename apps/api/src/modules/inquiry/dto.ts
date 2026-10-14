import { IsString, Length, Matches } from 'class-validator';
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
}

export class VerifyOtpDto extends RequestOtpDto {
  @ToAsciiDigits()
  @IsString()
  @Length(4, 8)
  code!: string;
}
