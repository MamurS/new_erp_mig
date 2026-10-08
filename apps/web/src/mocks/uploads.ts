/* Multipart intake on the mock server: form parsing; the attachment whitelist is the services' (services/uploads.ts). */
import { GUARANTEE_FILE_MAX_BYTES } from '@mig/domain/clinics';
import type { UploadedFile } from '@mig/domain/lib/uploads';
import { checkAttachment, type AttachmentMime } from '@mig/domain/services/uploads';
import { msg } from '@mig/i18n';
import { HttpError } from './http';

export type { AttachmentMime };

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'srv.form.invalid');
  }
}

/** PDF, JPEG, PNG up to 10 MB, checked by magic bytes (images arrive already re-encoded by the browser). */
export async function readAttachment(file: File): Promise<{ bytes: Uint8Array; mime: AttachmentMime }> {
  // The size is checked before the bytes are read.
  if (file.size === 0 || file.size > GUARANTEE_FILE_MAX_BYTES) throw new HttpError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  return checkAttachment({ bytes: new Uint8Array(await file.arrayBuffer()) });
}

/** The files of a form field as plain data for the services. */
export async function formFiles(form: FormData, field: string): Promise<UploadedFile[]> {
  const files = form.getAll(field).filter((f): f is File => f instanceof File);
  return Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

/** A text field of a form (`null` when absent or a file). */
export function formText(form: FormData, field: string): string | null {
  const v = form.get(field);
  return typeof v === 'string' ? v : null;
}
