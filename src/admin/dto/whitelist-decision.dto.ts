import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class WhitelistDecisionDto {
  @ApiProperty({
    description:
      'true whitelists the investor; false sends them back to identity_submitted to resubmit (WhitelistStatus has no rejected state).',
  })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({
    description:
      'Optional reviewer note, included in the investor notification.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
