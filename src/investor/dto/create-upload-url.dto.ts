import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn } from 'class-validator';
import { KycDocumentType } from '../../common/enums';

/** Content types a KYC document upload is allowed to be. */
export const KYC_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

/**
 * Body for POST /investor/whitelisting/upload-url. The backend generates the
 * object key server-side and returns a presigned R2 PUT URL — the client
 * never picks the key or touches this API with the file bytes.
 */
export class CreateUploadUrlDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  documentType!: KycDocumentType;

  @ApiProperty({ enum: KYC_ALLOWED_CONTENT_TYPES })
  @IsIn(KYC_ALLOWED_CONTENT_TYPES)
  contentType!: (typeof KYC_ALLOWED_CONTENT_TYPES)[number];
}
