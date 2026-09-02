import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OnChainAction, OnChainStatus } from '../../common/enums';

/**
 * Query for GET /admin/ledger — filters over the OnChainEvent mirror table.
 * Serves the frontend /admin/ledger screen.
 */
export class LedgerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OnChainAction })
  @IsOptional()
  @IsEnum(OnChainAction)
  action?: OnChainAction;

  @ApiPropertyOptional({ enum: OnChainStatus })
  @IsOptional()
  @IsEnum(OnChainStatus)
  status?: OnChainStatus;
}
