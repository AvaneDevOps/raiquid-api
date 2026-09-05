import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
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

  // Deliberately no platformFeePct / reserveContributionPct here: fees are
  // set server-side from the buyer's provenance tier (see
  // provenance-fee-schedule.ts), never chosen by whoever submits the
  // invoice. The global ValidationPipe's forbidNonWhitelisted rejects any
  // request that still sends them.
}
