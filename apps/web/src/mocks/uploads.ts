/* Multipart intake on the mock server: form parsing and the attachment whitelist (PDF, JPEG, PNG up to 10 MB). */
import { msg } from '@mig/i18n';
import { GUARANTEE_FILE_MAX_BYTES } from '@mig/domain/clinics';
import { detectMime } from '@/shared/lib/image';
import { HttpError } from './http';

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'srv.form.invalid');
  }
}

export type AttachmentMime = 'image/jpeg' | 'image/png' | 'application/pdf';

/** PDF, JPEG, PNG up to 10 MB, checked by magic bytes (images arrive already re-encoded by the browser). */
export async function readAttachment(file: File): Promise<{ bytes: Uint8Array; mime: AttachmentMime }> {
  if (file.size === 0 || file.size > GUARANTEE_FILE_MAX_BYTES) throw new HttpError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') {
    throw new HttpError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { files: msg('srv.file.unsupported') } });
  }
  return { bytes, mime };
}
