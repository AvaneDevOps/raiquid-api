import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateInvestorSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryOfResidence?: string;

  @ApiPropertyOptional({ description: 'Wallet address used to invest' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  investingWalletAddress?: string;
}
