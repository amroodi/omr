import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

// Central insurer desks an admin can assign (branch users are شعبه automatically). null = derive.
const DESKS = ['HQ', 'COUNCIL'];

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

  @IsOptional()
  @IsIn(DESKS)
  desk?: 'HQ' | 'COUNCIL';
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

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(DESKS)
  desk?: 'HQ' | 'COUNCIL' | null;
}

export class ResetPasswordDto {
  @IsString()
  @Length(8, 128)
  password!: string;
}
