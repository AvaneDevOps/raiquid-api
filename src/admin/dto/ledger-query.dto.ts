import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OnChainAction, OnChainStatus } from '../../common/enums';

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
