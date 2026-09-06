import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

/**
 * Body for POST /buyer/invoices/:id/pay — a buyer recording a repayment on an
 * invoice they owe. Serves the frontend /buyer/payment-schedule "Pay" action.
 */
export class PayInvoiceDto {
  @ApiProperty({ example: 25000.0, description: 'Amount being paid' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
