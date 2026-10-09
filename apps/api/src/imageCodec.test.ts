/*
 * Server-side re-encoding of uploads (files/imageCodec.ts, BACKEND_SPEC §8): decoded and drawn again — no Exif or
 * GPS left, the long side at most 2 000 px, JPEG 85 (WebP becomes JPEG), PNG stays PNG; undecodable bytes and
 * decompression bombs are refused, and the services answer 422 for them (services/uploads.ts `cleanFile`).
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { hasImageMetadata } from '@mig/domain/lib/imageMeta';
import { detectMime } from '@mig/domain/lib/uploads';
import { cleanFile } from '@mig/domain/services/uploads';
import { DomainError } from '@mig/domain/services/kernel';
import { MAX_SIDE, sharpImageCodec } from './files/imageCodec';

const codec = sharpImageCodec();

async function photo(width: number, height: number, format: 'jpeg' | 'png' | 'webp'): Promise<Uint8Array> {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).withExif({
    IFD0: { Make: 'PhoneCam', Model: 'X1' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 39/1', GPSLongitudeRef: 'E', GPSLongitude: '69/1 14/1 26/1' },
  });
  const out = format === 'jpeg' ? img.jpeg({ quality: 95 }) : format === 'png' ? img.png() : img.webp();
  return new Uint8Array(await out.toBuffer());
}

describe('server-side image re-encoding', () => {
  it('a phone photo with GPS: JPEG 85, long side 2 000 px, no metadata', async () => {
    const input = await photo(3000, 1200, 'jpeg');
    expect((await sharp(Buffer.from(input)).metadata()).exif).toBeDefined();
    const out = await codec.reencode(input, 'image/jpeg');
    expect(out.mime).toBe('image/jpeg');
    expect(detectMime(out.bytes)).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(MAX_SIDE);
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(800);
    expect(hasImageMetadata(out.bytes)).toBe(false);
  });

  it('a small image is not enlarged; WebP becomes JPEG; PNG stays PNG without metadata', async () => {
    const small = await codec.reencode(await photo(640, 480, 'jpeg'), 'image/jpeg');
    expect(await sharp(Buffer.from(small.bytes)).metadata()).toMatchObject({ width: 640, height: 480 });
    const webp = await codec.reencode(await photo(800, 600, 'webp'), 'image/webp');
    expect(webp.mime).toBe('image/jpeg');
    expect(detectMime(webp.bytes)).toBe('image/jpeg');
    const png = await codec.reencode(await photo(2400, 2400, 'png'), 'image/png');
    expect(png.mime).toBe('image/png');
    const pm = await sharp(Buffer.from(png.bytes)).metadata();
    expect(pm).toMatchObject({ format: 'png', width: 2000, height: 2000 });
    expect(pm.exif).toBeUndefined();
  });

  it('bytes appended after the image (a polyglot payload) do not survive', async () => {
    const input = await photo(300, 200, 'jpeg');
    const payload = new TextEncoder().encode('<script>alert(1)</script>');
    const out = await codec.reencode(new Uint8Array([...input, ...payload]), 'image/jpeg');
    expect(Buffer.from(out.bytes).includes(Buffer.from(payload))).toBe(false);
  });

  it('undecodable bytes and a decompression bomb are refused; the services answer 422', async () => {
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    await expect(codec.reencode(fake, 'image/jpeg')).rejects.toThrow();
    const bomb = new Uint8Array(await sharp({ create: { width: 10000, height: 10000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer());
    await expect(codec.reencode(bomb, 'image/png')).rejects.toThrow();
    const ctx = { env: { demo: false, images: codec } };
    await expect(cleanFile(ctx, fake, 'image/jpeg')).rejects.toBeInstanceOf(DomainError);
    // PDFs are kept as they are.
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    expect((await cleanFile(ctx, pdf, 'application/pdf')).bytes).toBe(pdf);
  });

  it('without a codec (the mock) metadata is stripped and the type kept', async () => {
    const input = await photo(400, 300, 'jpeg');
    const out = await cleanFile({ env: { demo: true } }, input, 'image/jpeg');
    expect(out.mime).toBe('image/jpeg');
    expect(hasImageMetadata(out.bytes)).toBe(false);
  });
});
