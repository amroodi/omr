import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

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

  // Mobile for reminder SMS (optional).
  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @Matches(/^0?9\d{9}$/, { message: 'شمارهٔ همراه نامعتبر است' })
  phone?: string;
}

export class UpdateUserDto {
  // Mobile for reminder SMS; '' clears it.
  @IsOptional()
  @ValidateIf((_, v) => v !== '')
  @Matches(/^0?9\d{9}$/, { message: 'شمارهٔ همراه نامعتبر است' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  displayName?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  // null moves a branch user to a central desk (with `desk`)
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  branchId?: string | null;

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
