import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'objectKey returned by POST /investor/whitelisting/upload-url for the identity document (backend-generated key, not an arbitrary path)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  identityDocumentKey?: string;

  @ApiPropertyOptional({
    description:
      'objectKey returned by POST /investor/whitelisting/upload-url for the proof of address',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  proofOfAddressKey?: string;
}
