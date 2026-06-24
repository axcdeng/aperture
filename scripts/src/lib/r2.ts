// Cloudflare R2 upload helper.
//
// R2 is S3-compatible, so we talk to it with the standard AWS SDK pointed at
// the account's R2 endpoint. Config comes from env (see SETUP.md):
//   R2_ACCOUNT_ID         - Cloudflare account id (used to build the endpoint)
//   R2_ACCESS_KEY_ID       - R2 API token access key
//   R2_SECRET_ACCESS_KEY   - R2 API token secret
//   R2_BUCKET              - target bucket name
//
// The bucket's public base URL (custom domain or r2.dev) is only needed by the
// web app for reads, so it lives there — not here.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

let cached: S3Client | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Add it to scripts/.env locally, or as a GitHub Actions secret in CI.`,
    );
  }
  return v;
}

export function r2Bucket(): string {
  return requireEnv('R2_BUCKET');
}

function client(): S3Client {
  if (cached) return cached;
  const accountId = requireEnv('R2_ACCOUNT_ID');
  cached = new S3Client({
    // R2 uses a single virtual region; 'auto' is the documented value.
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return cached;
}

/**
 * Upload an object to R2. Sets a long, immutable cache lifetime — keys are
 * content-stable (thumbs/<media-id>.webp), so once written they never change.
 */
export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/** Object key for a media item's 720p thumbnail. */
export function thumbKey(mediaId: string): string {
  return `thumbs/${mediaId}.webp`;
}
