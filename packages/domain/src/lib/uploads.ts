/*
 * Uploaded files without the browser: the type by magic bytes and the limits of claim attachments
 * (PDF, JPEG, PNG up to 10 MB, at most 10 files). The browser re-encodes images before upload.
 */

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

/** At most this many attachments per claim or guarantee letter. */
export const ATTACHMENT_MAX_FILES = 10;

/** The real type of a file by its first bytes (the declared MIME is not trusted). */
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

/** A file of a multipart request as the services see it (the adapter reads it). */
export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}
