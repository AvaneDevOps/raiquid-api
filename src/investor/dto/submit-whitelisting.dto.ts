import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';

/**
 * Body for POST /investor/whitelisting — an investor submitting identity /
 * residency details to start the whitelisting review. Serves the frontend
 * /investor/whitelisting screen.
 */
export class SubmitWhitelistingDto {
  @ApiProperty({
    example: 'PT',
    description: 'ISO 3166-1 alpha-2 country code',
  })
  @IsString()
  @Length(2, 2)
  countryOfResidence!: string;

  @ApiProperty({ example: 'Jordan Rivera' })
  @IsString()
  @MaxLength(200)
  legalName!: string;
}
