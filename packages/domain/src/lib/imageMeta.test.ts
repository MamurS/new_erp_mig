import { describe, expect, it } from 'vitest';
import { hasImageMetadata, stripImageMetadata } from './imageMeta';

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const text = (b: Uint8Array) => String.fromCharCode(...b);

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

const le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
function webpChunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
}

describe('server-side removal of image metadata', () => {
  it('JPEG: Exif (GPS), XMP and comments go; JFIF, Adobe, tables and the scan stay', () => {
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      ...segment(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
      ...segment(0xe1, ascii('Exif\0\0GPSLatitude 41.31 N')),
      ...segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')),
      ...segment(0xfe, ascii('taken at home')),
      ...segment(0xee, ascii('Adobe\0d\0\0\0\0\x01')),
      ...segment(0xdb, Array(65).fill(1)),
      ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
      0x12,
      0x34,
      0xff,
      0x00,
      0x56,
      0xff,
      0xd9,
    ]);
    const out = stripImageMetadata(jpeg);
    expect(text(out)).not.toMatch(/Exif|GPS|xmpmeta|taken at home/);
    expect(text(out)).toContain('JFIF');
    expect(text(out)).toContain('Adobe');
    expect(Array.from(out.subarray(-7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
    expect(hasImageMetadata(jpeg)).toBe(true);
    expect(hasImageMetadata(out)).toBe(false);
  });

  it('PNG: text, eXIf and time chunks go; the picture chunks stay', () => {
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...pngChunk('IHDR', Array(13).fill(0)),
      ...pngChunk('tEXt', ascii('Author\0Ivanov')),
      ...pngChunk('eXIf', ascii('MM\0*GPS')),
      ...pngChunk('pHYs', Array(9).fill(0)),
      ...pngChunk('IDAT', [1, 2, 3]),
      ...pngChunk('tIME', Array(7).fill(0)),
      ...pngChunk('IEND', []),
    ]);
    const out = stripImageMetadata(png);
    expect(text(out)).not.toMatch(/tEXt|Ivanov|eXIf|GPS|tIME/);
    for (const keep of ['IHDR', 'pHYs', 'IDAT', 'IEND']) expect(text(out)).toContain(keep);
  });

  it('WebP: EXIF and XMP chunks go and the VP8X flags no longer announce them; the RIFF size is fixed', () => {
    const body = [
      ...ascii('WEBP'),
      ...webpChunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...webpChunk('VP8L', [1, 2, 3, 4]),
      ...webpChunk('EXIF', ascii('GPS here')),
      ...webpChunk('XMP ', ascii('<xmp/>')),
    ];
    const webp = new Uint8Array([...ascii('RIFF'), ...le(body.length), ...body]);
    const out = stripImageMetadata(webp);
    expect(text(out)).not.toMatch(/EXIF|GPS|XMP|xmp/);
    expect(out[20]! & 0x0c).toBe(0);
    expect(out[4]! | (out[5]! << 8) | (out[6]! << 16) | (out[7]! << 24)).toBe(out.length - 8);
  });

  it('leaves PDFs and truncated non-metadata data as they are', () => {
    const pdf = new Uint8Array(ascii('%PDF-1.7\n/Author (Ivanov)'));
    expect(stripImageMetadata(pdf)).toBe(pdf);
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect(stripImageMetadata(truncated)).toEqual(truncated);
    const pngTruncated = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(stripImageMetadata(pngTruncated)).toEqual(pngTruncated);
    // A truncated metadata segment is dropped, not kept.
    const cut = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, ...ascii('Exif\0\0GPS')]);
    expect(text(stripImageMetadata(cut))).not.toMatch(/Exif|GPS/);
  });
});
