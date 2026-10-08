/*
 * Supabase Storage as the blob store of the file rows (BACKEND_SPEC §8), over its REST API with the service role
 * key. The buckets are private; the browser never talks to Storage: downloads go through the API (rights checked
 * per request), and a signed link is a 60-second Storage token the API redeems at `/api/files/signed`.
 */
import type { BlobStore, BucketId } from '@mig/domain/store/blob';
import { BUCKETS } from '@mig/domain/store/sql/migrationsAuth';
import { peekJwt } from '../auth/jwt';

export interface StorageOptions {
  /** SUPABASE_URL (Kong): `/storage/v1` is appended. */
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
}

const OBJECT =
  /^(receipts|contract-scans|guarantee-attachments|documents|help-assets)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class StorageError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`Supabase Storage ${status}: ${what}`);
    this.name = 'StorageError';
  }
}

export interface SupabaseStorage extends BlobStore {
  /** Creates the private buckets that are missing (the migration does it too when Storage's schema exists). */
  ensureBuckets(): Promise<void>;
  /** The bytes behind a signed token (validity and expiry are checked by Storage); null when refused. */
  redeem(token: string): Promise<{ bytes: Uint8Array; mime: string; object: string } | null>;
}

export function supabaseStorage(o: StorageOptions): SupabaseStorage {
  const base = `${o.url.replace(/\/+$/, '')}/storage/v1`;
  const f = o.fetch ?? fetch;
  const auth = { apikey: o.serviceKey, Authorization: `Bearer ${o.serviceKey}` };
  const path = (bucket: BucketId, name: string) =>
    `${encodeURIComponent(bucket)}/${encodeURIComponent(name)}`;

  return {
    async ensureBuckets() {
      const r = await f(`${base}/bucket`, { headers: auth });
      if (!r.ok) throw new StorageError(r.status, 'list buckets');
      const have = new Set(((await r.json()) as { id: string }[]).map((b) => b.id));
      for (const b of BUCKETS) {
        if (have.has(b.id)) continue;
        const c = await f(`${base}/bucket`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            id: b.id,
            name: b.id,
            public: false,
            file_size_limit: b.maxBytes,
            allowed_mime_types: b.mimes,
          }),
        });
        if (!c.ok && c.status !== 409) throw new StorageError(c.status, `create bucket ${b.id}`);
      }
    },
    async put(bucket, name, bytes, mime) {
      const r = await f(`${base}/object/${path(bucket, name)}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': mime, 'cache-control': 'no-store', 'x-upsert': 'false' },
        body: Buffer.from(bytes),
      });
      if (!r.ok) throw new StorageError(r.status, `upload to ${bucket}`);
    },
    async get(bucket, name) {
      const r = await f(`${base}/object/authenticated/${path(bucket, name)}`, { headers: auth });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new StorageError(r.status, `download from ${bucket}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async remove(bucket, name) {
      const r = await f(`${base}/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [name] }),
      });
      if (!r.ok && r.status !== 404) throw new StorageError(r.status, `remove from ${bucket}`);
    },
    async signedUrl(bucket, name, expiresInSec) {
      const r = await f(`${base}/object/sign/${path(bucket, name)}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSec }),
      });
      if (!r.ok) throw new StorageError(r.status, `sign in ${bucket}`);
      const { signedURL } = (await r.json()) as { signedURL: string };
      const token = new URL(signedURL, 'http://storage.local').searchParams.get('token');
      if (!token) throw new StorageError(500, 'no token in the signed URL');
      return `/api/files/signed?token=${encodeURIComponent(token)}`;
    },
    async redeem(token) {
      // The token names its object (`url` claim); Storage checks the signature and the expiry.
      const object = peekJwt(token)?.url;
      if (typeof object !== 'string' || !OBJECT.test(object)) return null;
      const r = await f(`${base}/object/sign/${object}?token=${encodeURIComponent(token)}`);
      if (!r.ok) return null;
      return {
        bytes: new Uint8Array(await r.arrayBuffer()),
        mime: r.headers.get('content-type') ?? 'application/octet-stream',
        object,
      };
    },
  };
}
