import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for POST /buyer/invoices/:id/pay — a buyer recording a repayment on an
 * invoice they owe. Serves the frontend /buyer/payment-schedule "Pay" action.
 */
export class PayInvoiceDto {
  @ApiProperty({ example: 25000.0, description: 'Amount being paid' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Buyer-side payment reference / memo. Stored on the description of each repayment ledger entry created for the invoice’s investors.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  paymentReference?: string;
}
