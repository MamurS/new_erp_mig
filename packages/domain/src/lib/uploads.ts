/*
 * Uploaded files without the browser: the type by magic bytes and the limits of claim attachments
 * (PDF, JPEG, PNG up to 10 MB, at most 10 files). The browser re-encodes images before upload.
 */

// The type by magic bytes is in mime.ts (one detector for receipts and attachments).
export { detectMime, IMAGE_MIME, type ImageMime } from './mime';

/** At most this many attachments per claim or guarantee letter. */
export const ATTACHMENT_MAX_FILES = 10;

/** A file of a multipart request as the services see it (the adapter reads it). */
export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}
