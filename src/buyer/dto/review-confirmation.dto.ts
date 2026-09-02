import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for the PUBLIC route POST /confirm/:invoiceId/review — a buyer accepting
 * or disputing an invoice from the emailed magic link. No Clerk session; the
 * `:invoiceId` path segment carries the opaque confirm token.
 *
 * Serves the frontend's standalone /confirm/[invoiceId] flow.
 */
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
