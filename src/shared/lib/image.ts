/* File intake: whitelist checks, magic bytes and canvas re-encoding (strips EXIF/GPS). */

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];
const EXT: Record<ImageMime, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
};

export const RECEIPT_LIMITS = { maxFiles: 5, maxBytes: 10 * 1024 * 1024, maxSide: 2000, quality: 0.85 };

export type FileCheckError = 'type' | 'size' | 'count' | 'content';

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

/** True if the JPEG bytes contain an EXIF APP1 segment. */
export function hasExif(bytes: Uint8Array): boolean {
  if (detectMime(bytes) !== 'image/jpeg') return false;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1]!;
    if (marker === 0xda) return false; // start of scan: no more metadata
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (
      marker === 0xe1 &&
      bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66
    )
      return true;
    i += 2 + len;
  }
  return false;
}

async function readHead(file: Blob, n = 16): Promise<Uint8Array> {
  const buf = await file.slice(0, n).arrayBuffer();
  return new Uint8Array(buf);
}

/** Validates one image against whitelist (MIME + extension + magic bytes) and size. */
export async function checkImageFile(
  file: File,
  maxBytes = RECEIPT_LIMITS.maxBytes,
): Promise<FileCheckError | null> {
  const mime = file.type as ImageMime;
  if (!IMAGE_MIME.includes(mime)) return 'type';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXT[mime].includes(ext)) return 'type';
  if (file.size === 0 || file.size > maxBytes) return 'size';
  const head = await readHead(file);
  if (detectMime(head) !== mime) return 'content';
  return null;
}

export function fitSize(w: number, h: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Re-encodes an image through canvas into JPEG. Drawing to canvas drops all metadata
 * (EXIF, GPS), so the output is clean regardless of the input.
 */
export async function reencodeImage(
  file: Blob,
  maxSide = RECEIPT_LIMITS.maxSide,
  quality = RECEIPT_LIMITS.quality,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
    );
  } finally {
    bitmap.close();
  }
}
