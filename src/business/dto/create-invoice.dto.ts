import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body for POST /business/invoices — a business submitting a new invoice for
 * financing. Serves the frontend "Submit invoice" form at /business/invoices.
 */
export class CreateInvoiceDto {
  @ApiProperty({ example: 'INV-2026-0042' })
  @IsString()
  @MaxLength(64)
  invoiceNumber!: string;

  @ApiProperty({ example: 25000.0, description: 'Face value of the invoice' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ example: 'NGN', default: 'NGN' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Invoice due date (ISO 8601)',
  })
  @IsISO8601()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'Q4 consulting services' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // --- Buyer (debtor) the invoice is billed to ---
  @ApiProperty({ example: 'Acme Manufacturing Ltd' })
  @IsString()
  @MaxLength(200)
  buyerLegalName!: string;

  @ApiProperty({ example: 'ap@acme.example' })
  @IsEmail()
  buyerContactEmail!: string;

  @ApiPropertyOptional({ example: '+1-555-0100' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  buyerContactPhone?: string;

  // --- Economics (percent values, e.g. 2.5 == 2.5%) ---
  @ApiPropertyOptional({ example: 2.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  platformFeePct?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  reserveContributionPct?: number;
}
