import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env.validation';

/**
 * Thin wrapper around an S3 client pointed at Cloudflare R2 (R2 speaks the
 * S3 API). The endpoint is derived from `R2_ACCOUNT_ID` — never hardcoded.
 *
 * Method bodies are stubs per the project-structure scope: object upload /
 * download / signed-URL logic lands with the invoice-document features
 * (business invoice attachments, investor whitelisting KYC documents).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const accountId = this.config.get('R2_ACCOUNT_ID', { infer: true });

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.get('R2_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: this.config.get('R2_SECRET_ACCESS_KEY', {
          infer: true,
        }),
      },
    });
    this.bucket = this.config.get('R2_BUCKET_NAME', { infer: true });
  }

  /** Expose the raw client for callers that need advanced operations. */
  get s3(): S3Client {
    return this.client;
  }

  /** @returns key of the stored object */
  uploadObject(_key: string, _body: Uint8Array | string): Promise<string> {
    // TODO: implement PutObjectCommand. Supports invoice-document upload on
    // POST /business/invoices and KYC upload on POST /investor/whitelisting.
    throw new NotImplementedException();
  }

  /** @returns time-limited download URL */
  getSignedDownloadUrl(_key: string): Promise<string> {
    // TODO: implement getSignedUrl(GetObjectCommand). Supports document
    // preview links across the business / investor / admin document views.
    throw new NotImplementedException();
  }

  deleteObject(_key: string): Promise<void> {
    // TODO: implement DeleteObjectCommand.
    throw new NotImplementedException();
  }
}
