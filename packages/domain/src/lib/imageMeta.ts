/*
 * Server-side removal of image metadata (BACKEND_SPEC §8: «изображения повторно перекодируются на сервере» —
 * the second line of defence after the browser's canvas re-encoding). Pure TypeScript without an image library:
 * the container is rewritten byte-wise and the pixels are left as they are.
 *
 * - JPEG: APP1…APP13, APP15 (Exif with GPS, XMP, Photoshop IRB…) and COM segments are dropped; APP0 (JFIF) and
 *   APP14 (Adobe colour transform, needed to decode CMYK) stay.
 * - PNG: only the chunks needed to draw the picture stay (IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP,
 *   sBIT, bKGD, pHYs); eXIf, tEXt, zTXt, iTXt, tIME and unknown chunks are dropped.
 * - WebP: EXIF and XMP chunks are dropped and their VP8X flags cleared.
 *
 * Malformed tails (a truncated segment) are kept as they are unless they belong to a metadata segment: a viewer
 * cannot read metadata out of them either. PDFs are not changed.
 */
import { detectMime } from './mime';

const KEEP_PNG = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
]);
const META_PNG = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return concat([...parts, b.subarray(i)]);
    const marker = b[i + 1]!;
    // Fill bytes and standalone markers (TEM, RSTn) have no length.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) return concat([...parts, b.subarray(i)]);
    if (i + 3 >= b.length) return concat([...parts, b.subarray(i)]);
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const meta = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    const end = i + 2 + len;
    if (len < 2 || end > b.length) return meta ? concat(parts) : concat([...parts, b.subarray(i)]);
    if (!meta) parts.push(b.subarray(i, end));
    i = end;
    // Start of scan: the entropy-coded data and the rest of the file follow.
    if (marker === 0xda) return concat([...parts, b.subarray(i)]);
  }
  return concat(parts);
}

const u32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return META_PNG.has(type) ? concat(parts) : concat([...parts, b.subarray(i)]);
    if (KEEP_PNG.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  if (i < b.length && i + 8 > b.length) parts.push(b.subarray(i));
  return concat(parts);
}

const le32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = le32(b, i + 4);
    const end = Math.min(b.length, i + 8 + len + (len & 1));
    const meta = type === 'EXIF' || type === 'XMP ';
    if (!meta) {
      const chunk = b.slice(i, end);
      // VP8X flags: bit 3 EXIF, bit 2 XMP.
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const head = b.slice(0, 12);
  const size = body.length + 4;
  head[4] = size & 0xff;
  head[5] = (size >>> 8) & 0xff;
  head[6] = (size >>> 16) & 0xff;
  head[7] = (size >>> 24) & 0xff;
  return concat([head, body]);
}

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Re-encoding of an uploaded image on the server (BACKEND_SPEC §8: the second line after the browser's canvas):
 * decoded and drawn again — JPEG and WebP as JPEG of quality 85, PNG as PNG, the long side at most 2 000 px, no
 * metadata. The API provides it (apps/api/src/files/imageCodec.ts); the mock has none and strips metadata only.
 */
export interface ImageCodec {
  reencode(bytes: Uint8Array, mime: ImageMime): Promise<{ bytes: Uint8Array; mime: ImageMime }>;
}

/** The image without its metadata (other files unchanged). */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  const mime = detectMime(bytes);
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/webp') return stripWebp(bytes);
  return bytes;
}

/** Whether a JPEG, PNG or WebP still carries Exif/XMP/text metadata (tests, checks). */
export function hasImageMetadata(bytes: Uint8Array): boolean {
  const s = stripImageMetadata(bytes);
  return s.length !== bytes.length || s.some((x, i) => x !== bytes[i]);
}
