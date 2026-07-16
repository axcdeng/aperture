// R2 write helper for the browser-driven album importer.
//
// The public site only *reads* R2 (see r2.ts). The import API routes, however,
// need to *write* the WebP derivatives that the browser produced. R2 is
// S3-compatible, so we talk to it with the AWS SDK pointed at the account's R2
// endpoint. This module is server-only (imported exclusively from route
// handlers running on the nodejs runtime) — it must never reach the client
// bundle, since it reads secret credentials.
//
//   R2_ACCOUNT_ID         - Cloudflare account id (builds the endpoint)
//   R2_ACCESS_KEY_ID       - R2 API token access key
//   R2_SECRET_ACCESS_KEY   - R2 API token secret
//   R2_BUCKET              - target bucket name

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

let cached: S3Client | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (needed for album uploads).`);
  return v;
}

/** True when all R2 write credentials are present. */
export function isR2WriteConfigured(): boolean {
  return (
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_BUCKET
  );
}

function client(): S3Client {
  if (cached) return cached;
  const accountId = requireEnv('R2_ACCOUNT_ID');
  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return cached;
}

export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET'),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/** True if the object already exists (content-hashed keys ⇒ identical bytes). */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: requireEnv('R2_BUCKET'), Key: key }));
    return true;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

// Object keys mirror scripts/src/lib/r2.ts exactly so both importers address
// the same bucket layout. The slug carries a content hash ⇒ stable keys.
export function albumFullKey(eventId: string, slug: string): string {
  return `albums/${eventId}/${slug}.full.webp`;
}
export function albumThumbKey(eventId: string, slug: string): string {
  return `albums/${eventId}/${slug}.thumb.webp`;
}
