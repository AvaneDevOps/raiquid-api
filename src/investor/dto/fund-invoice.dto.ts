import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

/**
 * Body for POST /investor/marketplace/:id/fund — an investor committing capital
 * to a listed invoice. Serves the frontend /investor/marketplace/[id] "Fund"
 * action.
 */
export class FundInvoiceDto {
  @ApiProperty({ example: 5000.0, description: 'Amount to invest' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
