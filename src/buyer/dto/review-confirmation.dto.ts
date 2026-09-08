import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewConfirmationDto {
  @ApiProperty({ description: 'true = accept the invoice, false = dispute it' })
  @IsBoolean()
  accept!: boolean;

  @ApiPropertyOptional({ description: 'Optional note, shown to the business' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
