import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const IMAGE_SIZES = { sm: 400, lg: 1200, orig: 2400 } as const;
export type ImageSize = keyof typeof IMAGE_SIZES;

export function imageDir(uploadDir: string, id: string) {
  return join(uploadDir, id.slice(0, 2), id);
}

export function imagePath(uploadDir: string, id: string, size: ImageSize) {
  return join(imageDir(uploadDir, id), `${size}.webp`);
}

function toHex(c: { r: number; g: number; b: number }) {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Stores an uploaded image as WebP in three sizes (never upscaled) and returns its
 * size and dominant colour. Throws if the bytes are not an image sharp can read.
 */
export async function storeImage(uploadDir: string, id: string, input: Buffer) {
  const base = sharp(input, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error('Not an image');
  const dir = imageDir(uploadDir, id);
  await mkdir(dir, { recursive: true });
  try {
    for (const [size, max] of Object.entries(IMAGE_SIZES)) {
      const out = await base
        .clone()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: size === 'sm' ? 78 : 85 })
        .toBuffer();
      await writeFile(join(dir, `${size}.webp`), out);
    }
    const { dominant } = await base.clone().resize(64, 64, { fit: 'inside' }).stats();
    // EXIF rotation swaps the reported width/height for portrait photos.
    const rotated = (meta.orientation ?? 1) >= 5;
    return {
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      color: toHex(dominant),
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
