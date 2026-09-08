import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class FundInvoiceDto {
  @ApiProperty({
    example: 5000,
    minimum: 5000,
    description: 'Amount to invest',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(5000)
  amount!: number;
}
