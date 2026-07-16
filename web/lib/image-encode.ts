// Client-side image downscaler. Runs entirely in the browser: decode the
// uploaded JPEG/PNG, honor its EXIF orientation, and re-encode to two WebP
// derivatives — a ~1080px display image and a ~500px thumbnail. The 4K original
// never leaves the device; only the small WebPs are uploaded to R2.
//
// Browser-only (uses createImageBitmap / canvas). Import from client components.

export const FULL_MAX = 1080;
export const THUMB_MAX = 500;
const FULL_QUALITY = 0.8;
const THUMB_QUALITY = 0.75;

export interface EncodedImage {
  full: Blob;
  thumb: Blob;
  width: number; // display width of the full derivative
  height: number;
}

function fitScale(w: number, h: number, max: number): number {
  return Math.min(1, max / Math.max(w, h));
}

async function toBitmap(file: Blob): Promise<ImageBitmap> {
  // imageOrientation:'from-image' bakes EXIF rotation into the pixels so the
  // re-encoded WebP is upright (canvas ignores EXIF otherwise).
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function draw(bitmap: ImageBitmap, max: number): HTMLCanvasElement {
  const scale = fitScale(bitmap.width, bitmap.height, max);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('WebP encode failed'))),
      'image/webp',
      quality,
    );
  });
}

/** Decode + downscale one image file into full + thumb WebP blobs. */
export async function encodeImage(file: File): Promise<EncodedImage> {
  const bitmap = await toBitmap(file);
  try {
    const fullCanvas = draw(bitmap, FULL_MAX);
    const thumbCanvas = draw(bitmap, THUMB_MAX);
    const [full, thumb] = await Promise.all([
      encode(fullCanvas, FULL_QUALITY),
      encode(thumbCanvas, THUMB_QUALITY),
    ]);
    return { full, thumb, width: fullCanvas.width, height: fullCanvas.height };
  } finally {
    bitmap.close();
  }
}

const IMAGE_RE = /\.(jpe?g|png)$/i;

/** True if the file looks like a supported still image (jpg/png). */
export function isSupportedImage(file: File): boolean {
  return IMAGE_RE.test(file.name) || file.type === 'image/jpeg' || file.type === 'image/png';
}
