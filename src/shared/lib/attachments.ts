/*
 * Guarantee-letter attachments (CLINIC_SPEC §9.7): PDF, JPEG, PNG up to 10 MB, at most 10 files.
 * Type is checked by extension, declared MIME and magic bytes; images are re-encoded through canvas
 * (drops EXIF/GPS). Files get neutral names without personal data.
 */
import { t } from '@/i18n';
import { GUARANTEE_FILE_MAX_BYTES } from '@/shared/domain/clinics';
import { detectMime, reencodeImage } from './image';

export const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export const ATTACHMENT_MAX_FILES = 10;

const EXT: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] };

export async function prepareAttachment(file: File, index: number): Promise<{ file: File } | { error: string }> {
  const declared = file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXT[declared]?.includes(ext)) return { error: t('v.file.types') };
  if (file.size === 0 || file.size > GUARANTEE_FILE_MAX_BYTES) return { error: t('v.file.tooLarge', { mb: 10 }) };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const actual = detectMime(head);
  if (actual !== declared) return { error: t('v.file.mismatch') };
  if (actual === 'application/pdf') return { file: new File([file], `document-${index + 1}.pdf`, { type: 'application/pdf' }) };
  const clean = await reencodeImage(file);
  return { file: new File([clean], `document-${index + 1}.jpg`, { type: 'image/jpeg' }) };
}

/** Signed scan of a contract or an endorsement (LIFECYCLE_SPEC §8.4): PDF, JPEG, PNG up to 20 MB, same checks. */
export const SCAN_MAX_BYTES = 20 * 1024 * 1024;
export async function prepareScan(file: File): Promise<{ file: File } | { error: string }> {
  const declared = file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!EXT[declared]?.includes(ext)) return { error: t('v.file.types') };
  if (file.size === 0 || file.size > SCAN_MAX_BYTES) return { error: t('v.file.tooLarge', { mb: 20 }) };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const actual = detectMime(head);
  if (actual !== declared) return { error: t('v.file.mismatch') };
  if (actual === 'application/pdf') return { file: new File([file], 'scan.pdf', { type: 'application/pdf' }) };
  const clean = await reencodeImage(file, 3000, 0.9);
  return { file: new File([clean], 'scan.jpg', { type: 'image/jpeg' }) };
}
