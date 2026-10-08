/*
 * File bytes outside the database (BACKEND_SPEC §8): private Supabase Storage buckets in the API, nothing in the
 * mock (the memory repositories keep bytes in the row). The Postgres repositories store the bytes of a file row
 * here under the row's id (a UUID, no personal data) and keep the bucket, the object name, the SHA-256 and the
 * size in the row (migration …_files_storage.sql).
 */
import type { FileRow } from './db';

export type BucketId = 'receipts' | 'contract-scans' | 'guarantee-attachments' | 'documents' | 'help-assets';

export interface BlobStore {
  put(bucket: BucketId, name: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** The bytes, or null when the object is missing. */
  get(bucket: BucketId, name: string): Promise<Uint8Array | null>;
  remove(bucket: BucketId, name: string): Promise<void>;
  /** A link valid for `expiresInSec` seconds that the API serves without a session (`/api/files/signed?token=…`). */
  signedUrl(bucket: BucketId, name: string, expiresInSec: number): Promise<string>;
}

/** The bucket of a file: receipts and claim attachments, guarantee-letter attachments, signed scans, other documents. */
export function bucketOf(
  f: Pick<FileRow, 'claimId' | 'insuredId' | 'guaranteeId' | 'contractId' | 'endorsementId'>,
): BucketId {
  if (f.guaranteeId) return 'guarantee-attachments';
  if (f.contractId || f.endorsementId) return 'contract-scans';
  if (f.claimId || f.insuredId) return 'receipts';
  return 'documents';
}

/** SHA-256 (hex) of stored bytes (WebCrypto: the same in Node and the browser). */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Bytes in memory (tests of the repositories without Storage). */
export function memoryBlobStore(): BlobStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(bucket, name, bytes) {
      objects.set(`${bucket}/${name}`, bytes.slice());
    },
    async get(bucket, name) {
      return objects.get(`${bucket}/${name}`)?.slice() ?? null;
    },
    async remove(bucket, name) {
      objects.delete(`${bucket}/${name}`);
    },
    async signedUrl(bucket, name, expiresInSec) {
      return `/api/files/signed?token=${encodeURIComponent(`${bucket}/${name}:${expiresInSec}`)}`;
    },
  };
}
