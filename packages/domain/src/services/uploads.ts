/* Attachments of a multipart request: the whitelist (PDF, JPEG, PNG up to 10 MB), checked by magic bytes. */
import { msg } from '@mig/i18n';
import { GUARANTEE_FILE_MAX_BYTES } from '../clinics';
import { stripImageMetadata, type ImageMime } from '../lib/imageMeta';
import { detectMime, type UploadedFile } from '../lib/uploads';
import { DomainError, type BaseCtx } from './kernel';

export type AttachmentMime = 'image/jpeg' | 'image/png' | 'application/pdf';

/**
 * The stored bytes of an uploaded file: images are re-encoded on the server (the API: decoded and drawn again,
 * JPEG 85 / PNG, long side ≤ 2 000 px — BACKEND_SPEC §8) or, in the mock, stripped of their metadata (Exif, GPS,
 * XMP, text); other files are kept as they are. A file the codec cannot decode is refused (422).
 */
export async function cleanFile<M extends string>(ctx: Pick<BaseCtx, 'env'>, bytes: Uint8Array, mime: M): Promise<{ bytes: Uint8Array; mime: M | 'image/jpeg' }> {
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') return { bytes, mime };
  const codec = ctx.env.images;
  if (!codec) return { bytes: stripImageMetadata(bytes), mime };
  try {
    const out = await codec.reencode(bytes, mime as ImageMime);
    return { bytes: out.bytes, mime: out.mime as M | 'image/jpeg' };
  } catch {
    throw new DomainError(422, 'validation', 'srv.file.unsupported', { fields: { files: msg('srv.file.unsupported') } });
  }
}

/**
 * PDF, JPEG, PNG up to 10 MB; 422 otherwise. Images arrive already re-encoded by the browser and are re-encoded
 * once more here (`cleanFile`). The returned bytes are what is stored.
 */
export async function checkAttachment(ctx: Pick<BaseCtx, 'env'>, file: Pick<UploadedFile, 'bytes'>): Promise<{ bytes: Uint8Array; mime: AttachmentMime }> {
  const { bytes } = file;
  if (bytes.length === 0 || bytes.length > GUARANTEE_FILE_MAX_BYTES) throw new DomainError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') {
    throw new DomainError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { files: msg('srv.file.unsupported') } });
  }
  return cleanFile(ctx, bytes, mime);
}
