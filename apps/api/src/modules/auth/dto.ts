import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class OrgLoginDto {
  @IsString()
  tenantSlug!: string;

  @IsString()
  @Length(3, 64)
  username!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  @IsOptional()
  @IsString()
  totp?: string;
}

export class SuperAdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  @IsOptional()
  @IsString()
  totp?: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(6, 128)
  currentPassword!: string;

  @IsString()
  @Length(8, 128)
  newPassword!: string;
}
