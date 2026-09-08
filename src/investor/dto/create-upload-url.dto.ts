import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn } from 'class-validator';
import { KycDocumentType } from '../../common/enums';

export const KYC_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export class CreateUploadUrlDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  documentType!: KycDocumentType;

  @ApiProperty({ enum: KYC_ALLOWED_CONTENT_TYPES })
  @IsIn(KYC_ALLOWED_CONTENT_TYPES)
  contentType!: (typeof KYC_ALLOWED_CONTENT_TYPES)[number];
}
