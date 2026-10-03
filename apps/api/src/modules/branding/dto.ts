import { IsHexColor, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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
