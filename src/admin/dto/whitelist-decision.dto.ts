import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /admin/whitelisting/:investorId/decision — an operator
 * approving or rejecting an investor's whitelisting review. Serves the frontend
 * /admin whitelisting queue.
 */
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
