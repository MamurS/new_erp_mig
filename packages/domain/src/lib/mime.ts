/* File types by magic bytes and the limits of receipt photos: the server checks uploads with them. */
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

export const RECEIPT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024, maxSide: 2000, quality: 0.85 };

export function detectMime(bytes: Uint8Array): ImageMime | 'application/pdf' | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  )
    return 'image/webp';
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'application/pdf';
  return null;
}
