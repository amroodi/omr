import { IsString, Length, Matches } from 'class-validator';

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
