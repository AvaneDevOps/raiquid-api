import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.validation';

// Presigned URLs are short-lived: long enough to pick a file and upload it,
// not long enough to be a durable capability if one leaks.
const PRESIGN_EXPIRY_SECONDS = 600;

/**
 * Cloudflare R2 (S3-API-compatible) access, presigned-URL only. The API never
 * proxies file bytes — clients PUT straight to R2 and GET straight from it
 * using URLs signed here. The endpoint is derived from `R2_ACCOUNT_ID`.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    const accountId = config.get('R2_ACCOUNT_ID', { infer: true });
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.bucket = config.get('R2_BUCKET_NAME', { infer: true });
  }

  /**
   * Presigned PUT URL. `content-type` is added to the signed headers, so R2
   * rejects the upload unless the client's PUT sends exactly this
   * `Content-Type` — it can't swap in a different file type.
   */
  createUploadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      {
        expiresIn: PRESIGN_EXPIRY_SECONDS,
        signableHeaders: new Set(['content-type']),
      },
    );
  }

  /** Presigned GET URL — for admin document review (not wired to a route yet). */
  createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS },
    );
  }
}
