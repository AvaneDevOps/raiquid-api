import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

/**
 * Body for POST /investor/whitelisting — an investor submitting identity /
 * residency details to start the whitelisting review. Serves the frontend
 * /investor/whitelisting screen.
 *
 * KYC document uploads go through StorageService separately; this carries the
 * uploaded object keys.
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

  @ApiPropertyOptional({
    description: 'StorageService object key for the uploaded ID document',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  identityDocumentKey?: string;

  @ApiPropertyOptional({
    description: 'StorageService object key for the uploaded proof of address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  proofOfAddressKey?: string;
}
