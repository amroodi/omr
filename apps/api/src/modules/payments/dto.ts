import { IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ProposePaymentDto {
  @IsUUID()
  caseId!: string;

  @IsNumberString()
  amount!: string; // integer/decimal as string (Rial/Toman)

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;
}

export class DecisionDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
