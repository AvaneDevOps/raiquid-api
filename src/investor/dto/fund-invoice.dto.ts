import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

/**
 * Body for POST /investor/marketplace/:id/fund — an investor committing capital
 * to a listed invoice. Serves the frontend /investor/marketplace/[id] "Fund"
 * action.
 */
export class FundInvoiceDto {
  @ApiProperty({
    example: 5000,
    minimum: 5000,
    description: 'Amount to invest',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  // ₦5,000 hard minimum — the one confirmed constant from the frontend screens.
  @Min(5000)
  amount!: number;
}
