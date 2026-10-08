/* Multipart intake on the mock server: form parsing; the attachment whitelist is the services' (services/uploads.ts). */
import type { UploadedFile } from '@mig/domain/lib/uploads';
import { HttpError } from './http';

export async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, 'validation', 'srv.form.invalid');
  }
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
