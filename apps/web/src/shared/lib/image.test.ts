import { describe, expect, it } from 'vitest';
import { checkImageFile, detectMime, fitSize, hasExif } from './image';

const jpegWithExif = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02,
]);
const jpegPlain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('image', () => {
  it('detects magic bytes', () => {
    expect(detectMime(jpegPlain)).toBe('image/jpeg');
    expect(detectMime(png)).toBe('image/png');
    expect(detectMime(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(detectMime(new TextEncoder().encode('<svg'))).toBeNull();
  });
  it('detects exif', () => {
    expect(hasExif(jpegWithExif)).toBe(true);
    expect(hasExif(jpegPlain)).toBe(false);
  });
  it('checks whitelist, extension, size and content', async () => {
    expect(await checkImageFile(new File([jpegPlain], 'r.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(await checkImageFile(new File([jpegPlain], 'r.svg', { type: 'image/svg+xml' }))).toBe('type');
    expect(await checkImageFile(new File([jpegPlain], 'r.png', { type: 'image/jpeg' }))).toBe('type');
    expect(await checkImageFile(new File([png], 'r.jpg', { type: 'image/jpeg' }))).toBe('content');
    expect(await checkImageFile(new File([jpegPlain], 'r.jpg', { type: 'image/jpeg' }), 4)).toBe('size');
  });
  it('fits long side', () => {
    expect(fitSize(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitSize(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});
