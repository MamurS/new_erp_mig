/*
 * Server-side re-encoding of uploaded images (BACKEND_SPEC §8, the second line after the browser's canvas, SPEC
 * «JPEG 0.85, long side ≤ 2 000 px»): the image is decoded and drawn again with sharp (libvips), so nothing of the
 * original file survives but its pixels — no Exif with GPS, XMP, ICC text, comments, trailing bytes or polyglot
 * payloads. JPEG and WebP become JPEG of quality 85, PNG stays PNG (scans and screenshots keep sharp text); the
 * camera's orientation is applied before the metadata is dropped. Bombs are refused by the pixel limit.
 */
import sharp from 'sharp';
import type { ImageCodec, ImageMime } from '@mig/domain/lib/imageMeta';

export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 85;
/** Decoded pixels at most (a 10 MB file may not unpack into gigabytes). */
const MAX_INPUT_PIXELS = 50_000_000;

export function sharpImageCodec(): ImageCodec {
  sharp.cache(false);
  return {
    async reencode(bytes: Uint8Array, mime: ImageMime) {
      const img = sharp(Buffer.from(bytes), { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
      if (mime === 'image/png') return { bytes: new Uint8Array(await img.png({ compressionLevel: 9 }).toBuffer()), mime: 'image/png' };
      return {
        bytes: new Uint8Array(await img.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, chromaSubsampling: '4:2:0' }).toBuffer()),
        mime: 'image/jpeg',
      };
    },
  };
}
