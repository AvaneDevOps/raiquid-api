import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max } from 'class-validator';

export class DepositDto {
  @ApiProperty({
    example: 500000,
    description: 'Amount of simulated sandbox funds to add to the wallet',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000)
  amount!: number;
}
