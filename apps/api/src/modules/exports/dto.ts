import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';

/** A ready-made table (the report builder's current view) to save as an Excel file. */
export class TableExportDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 400)
  subtitle?: string;

  @IsArray()
  @ArrayMaxSize(120)
  @IsString({ each: true })
  headers!: string[];

  /** Rows of cell values (text or numbers), in the same order as `headers`. */
  @IsArray()
  @ArrayMaxSize(20000)
  rows!: (string | number | null)[][];
}
