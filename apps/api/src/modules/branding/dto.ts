import { IsArray, IsHexColor, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  noticeDays?: number; // insurer's claim-notice deadline window

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  contactHeader?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  fontFamily?: string;

  // Origins allowed to embed the inquiry widget (e.g. "https://damuon.ir"). Scheme + host only.
  @IsOptional()
  @IsArray()
  @Matches(/^https?:\/\/[a-zA-Z0-9.:-]+$/, { each: true, message: 'هر مبدأ باید مانند https://example.com باشد' })
  embedOrigins?: string[];
}

export class SmsConfigDto {
  @IsString() @Length(2, 40) driver!: string;
  @IsOptional() @IsString() @Length(0, 120) sender?: string;
  @IsOptional() @IsString() @Length(0, 300) apiKey?: string;
  @IsOptional() @IsString() @Length(0, 120) username?: string;
  @IsOptional() @IsString() @Length(0, 200) password?: string;
  @IsOptional() @IsString() @Length(0, 120) domain?: string;
  @IsOptional() @IsString() @Length(0, 120) otpPattern?: string;
  @IsOptional() @IsString() @Length(0, 60) otpTemplateId?: string;
  @IsOptional() @IsString() @Length(0, 20) notifyPhone?: string;
}

export class TestSmsDto {
  @IsString() @Length(8, 20) phone!: string;
}

export class CarrierConfigDto {
  @IsString()
  @Length(2, 40)
  carrier!: string; // e.g. "alborz"

  @IsString()
  @Length(4, 300)
  baseUrl!: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
