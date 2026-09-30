import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(3, 64)
  username!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  displayName?: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsUUID()
  roleId!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  displayName?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @Length(8, 128)
  password!: string;
}
