import { IsString, Length, Matches } from 'class-validator';

// National ID: 10 digits (Persian digits normalized upstream). Phone: Iranian mobile.
export class RequestOtpDto {
  @IsString()
  @Length(8, 12)
  nationalCode!: string;

  @IsString()
  @Matches(/^(\+?98|0)?9\d{9}$/, { message: 'شماره موبایل نامعتبر است' })
  phone!: string;
}

export class VerifyOtpDto extends RequestOtpDto {
  @IsString()
  @Length(4, 8)
  code!: string;
}
