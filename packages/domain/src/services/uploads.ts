/* Attachments of a multipart request: the whitelist (PDF, JPEG, PNG up to 10 MB), checked by magic bytes. */
import { msg } from '@mig/i18n';
import { GUARANTEE_FILE_MAX_BYTES } from '../clinics';
import { stripImageMetadata } from '../lib/imageMeta';
import { detectMime, type UploadedFile } from '../lib/uploads';
import { DomainError } from './kernel';

export type AttachmentMime = 'image/jpeg' | 'image/png' | 'application/pdf';

/**
 * PDF, JPEG, PNG up to 10 MB; 422 otherwise. Images arrive already re-encoded by the browser; their metadata
 * (Exif, GPS, XMP, text) is removed here once more (BACKEND_SPEC §8). The returned bytes are what is stored.
 */
export function checkAttachment(file: Pick<UploadedFile, 'bytes'>): { bytes: Uint8Array; mime: AttachmentMime } {
  const { bytes } = file;
  if (bytes.length === 0 || bytes.length > GUARANTEE_FILE_MAX_BYTES) throw new DomainError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') {
    throw new DomainError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { files: msg('srv.file.unsupported') } });
  }
  return { bytes: stripImageMetadata(bytes), mime };
}
