/*
 * Files (BACKEND_SPEC §8) against the local stack: uploads only through the API with type by magic bytes, size
 * and count limits; metadata stripped on the server; bytes in a private Storage bucket under a UUID with the
 * SHA-256 in the file row; downloads after the rights check, and 60-second signed links with the same rights.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasImageMetadata, stripImageMetadata } from '@mig/domain/lib/imageMeta';
import type { Db } from '@mig/domain/store/db';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_HR, DEMO_INSURED_PHONE, DEMO_SPOUSE_PHONE, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { storageGc } from './files/gc';
import { peekJwt } from './auth/jwt';
import { SESSION_COOKIE } from './auth/cookies';
import { serverDeps } from './deps';
import { hasSupabase, testBff, testStack, type TestStack } from './test/supabase';
import {
  fastifyClient,
  hasDb,
  loadSeed,
  multipart,
  signIn as signInAs,
  testPool,
  type Client,
  type Who,
} from './test/support';

const T = Math.floor(Date.now() / 60_000) * 60_000;

/** A small JPEG with an Exif segment carrying a GPS position (what a phone camera writes). */
function jpegWithExif(seed: number): Uint8Array {
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from(`GPSLatitude 41.311081 N GPSLongitude 69.240562 E #${seed}`, 'latin1'),
  ]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(exif.length + 2) >> 8, (exif.length + 2) & 0xff]),
    exif,
  ]);
  const jfif = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00,
  ]);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 1)]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jfif,
      app1,
      dqt,
      sos,
      Buffer.from([0x12, 0x34, seed & 0xff, 0x56]),
      Buffer.from([0xff, 0xd9]),
    ]),
  );
}

describe.skipIf(!hasDb || !hasSupabase)('files: uploads, Storage, downloads and signed links', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let stack: TestStack;
  let d: Db;
  const crypto = devAesPiiCrypto();
  const errors: string[] = [];
  const signIn = (who: Who) => signInAs(api, who, SESSION_COOKIE);
  const plusDays = (n: number) => new Date(T + 5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

  async function receiptForm(files: { bytes: Uint8Array; name: string; type: string }[]) {
    const form = new FormData();
    form.set('category', 'medicines');
    form.set('amount', '125000');
    form.set('serviceDate', plusDays(-2));
    form.set('providerName', 'Apteka Test');
    for (const f of files)
      form.append('files', new File([f.bytes as Uint8Array<ArrayBuffer>], f.name, { type: f.type }));
    return multipart(form);
  }

  /** The stored attachment of a claim (the insured person's answer has no file list). */
  async function attachmentOf(claimId: string): Promise<{ id: string; url: string; sizeBytes: number }> {
    const { rows } = await pool.query(`select attachments from public.claims where id = $1`, [claimId]);
    return (rows[0].attachments as { id: string; url: string; sizeBytes: number }[])[0]!;
  }

  beforeAll(async () => {
    d = createSeed({ now: T });
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    stack = testStack(pool, crypto);
    app = await buildApp({
      pool,
      crypto,
      deps: serverDeps({ demo: true }),
      auth: testBff(pool, crypto, stack),
      storage: stack.storage,
      now: () => T + 3600_000,
      onError: (e, route) => errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`),
    });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    expect(errors).toEqual([]);
  });

  describe('uploads', () => {
    it.each([
      [
        'a file whose bytes are not an image (wrong magic bytes)',
        [
          {
            bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
            name: 'receipt.jpg',
            type: 'image/jpeg',
          },
        ],
        'srv.receipt.onlyImages',
      ],
      [
        'a file above 10 MB',
        [{ bytes: new Uint8Array(10 * 1024 * 1024 + 1).fill(0xff), name: 'big.jpg', type: 'image/jpeg' }],
        'srv.file.tooLarge10mb',
      ],
      [
        'more than five photos',
        Array.from({ length: 6 }, (_, i) => ({
          bytes: jpegWithExif(i),
          name: `r${i}.jpg`,
          type: 'image/jpeg',
        })),
        'srv.receipt.max5',
      ],
    ])('rejects %s', async (_label, files, key) => {
      const sid = await signIn({ phone: DEMO_INSURED_PHONE });
      const before = (await pool.query('select count(*)::int as n from public.files')).rows[0].n;
      const r = await api.call('POST', '/me/claims', { session: sid, raw: await receiptForm(files) });
      expect(r.status).toBe(422);
      expect(r.body).toMatchObject({ code: 'validation', key });
      expect((await pool.query('select count(*)::int as n from public.files')).rows[0].n).toBe(before);
    });

    it('stores the photo without Exif/GPS in the private bucket under its UUID, with the SHA-256 in the row', async () => {
      const sid = await signIn({ phone: DEMO_INSURED_PHONE });
      const photo = jpegWithExif(42);
      expect(hasImageMetadata(photo)).toBe(true);
      const r = await api.call('POST', '/me/claims', {
        session: sid,
        raw: await receiptForm([{ bytes: photo, name: 'IMG_0042.jpg', type: 'image/jpeg' }]),
      });
      expect(r.status).toBe(200);
      const att = await attachmentOf((r.body as { id: string }).id);
      // The download: the clean image.
      const got = await api.call('GET', att.url.replace(/^\/api/, ''), { session: sid });
      expect(got.status).toBe(200);
      const bytes = Buffer.from(got.text, 'latin1');
      expect(got.contentType).toBe('image/jpeg');
      expect(got.headers['cache-control']).toBe('no-store');
      const raw = await app.inject({
        method: 'GET',
        url: att.url,
        headers: { cookie: `${SESSION_COOKIE}=${sid}` },
      });
      const stored = new Uint8Array(raw.rawPayload);
      expect(Buffer.from(stored).toString('latin1')).not.toMatch(/Exif|GPS/);
      expect(stored).toEqual(stripImageMetadata(photo));
      expect(bytes.length).toBeGreaterThan(0);
      // The row: bucket, the object under the row's id, the SHA-256 and size of the stored bytes.
      const row = (
        await pool.query(
          `select bucket, object_name::text as name, sha256, size_bytes::int as size from public.files where id = $1`,
          [att.id],
        )
      ).rows[0];
      expect(row).toEqual({
        bucket: 'receipts',
        name: att.id,
        sha256: createHash('sha256').update(stored).digest('hex'),
        size: stored.length,
      });
      expect(att.sizeBytes).toBe(stored.length);
      // Storage itself holds the clean bytes in a private bucket.
      expect(await stack.storage.get('receipts', att.id)).toEqual(stored);
      const anon = await fetch(
        `${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/storage/v1/object/public/receipts/${att.id}`,
      );
      expect(anon.ok).toBe(false);
    });

    it('a seeded receipt (no stored photo) is drawn as a picture', async () => {
      const sid = await signIn({ email: DEMO_STAFF.find((s) => s.role === 'operator')!.email });
      const seeded = d.files.find((f) => f.seedText && f.claimId)!;
      const r = await app.inject({
        method: 'GET',
        url: `/api/files/${seeded.id}`,
        headers: { cookie: `${SESSION_COOKIE}=${sid}` },
      });
      expect(r.statusCode).toBe(200);
      const png = new Uint8Array(r.rawPayload);
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.length).toBeGreaterThan(200);
    });
  });

  describe('signed links (60 s) with the rights of the download', () => {
    let fileId = '';
    let owner = '';

    beforeAll(async () => {
      owner = await signIn({ phone: DEMO_INSURED_PHONE });
      const r = await api.call('POST', '/me/claims', {
        session: owner,
        raw: await receiptForm([{ bytes: jpegWithExif(7), name: 'r.jpg', type: 'image/jpeg' }]),
      });
      fileId = (await attachmentOf((r.body as { id: string }).id)).id;
    });

    it('the owner gets a link that works without a session and names no person', async () => {
      const link = await api.call('GET', `/files/${fileId}/link`, { session: owner });
      expect(link.status).toBe(200);
      const { url, expiresInSec } = link.body as { url: string; expiresInSec: number };
      expect(expiresInSec).toBe(60);
      expect(url).toMatch(/^\/api\/files\/signed\?token=/);
      const token = new URL(url, 'http://x').searchParams.get('token')!;
      const claims = peekJwt(token)!;
      expect(Number(claims.exp) - Number(claims.iat)).toBe(60);
      expect(claims.url).toBe(`receipts/${fileId}`);
      const got = await app.inject({ method: 'GET', url });
      expect(got.statusCode).toBe(200);
      expect(got.headers['content-type']).toBe('image/jpeg');
      expect(new Uint8Array(got.rawPayload)).toEqual(stripImageMetadata(jpegWithExif(7)));
    });

    it('a tampered or foreign-object token is refused', async () => {
      const link = await api.call('GET', `/files/${fileId}/link`, { session: owner });
      const token = new URL((link.body as { url: string }).url, 'http://x').searchParams.get('token')!;
      const [h, p, s] = token.split('.');
      const other = Buffer.from(
        JSON.stringify({ ...peekJwt(token), url: `receipts/${d.files[0]!.id}` }),
      ).toString('base64url');
      expect(
        (await app.inject({ method: 'GET', url: `/api/files/signed?token=${h}.${other}.${s}` })).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: `/api/files/signed?token=${h}.${p}.${s!.slice(0, -2)}AA` }))
          .statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/files/signed?token=nope' })).statusCode).toBe(404);
    });

    it('another insured person gets 404, HR 403, MIG claims staff a link; no session is 401', async () => {
      const spouse = await signIn({ phone: DEMO_SPOUSE_PHONE });
      const me = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
      const spouseRow = d.insured.find((i) => i.phone === DEMO_SPOUSE_PHONE)!;
      // The spouse is another person (a file of the employee is not hers).
      expect(spouseRow.id).not.toBe(me.id);
      expect((await api.call('GET', `/files/${fileId}/link`, { session: spouse })).status).toBe(404);
      const hr = await signIn({ email: DEMO_HR.email });
      expect((await api.call('GET', `/files/${fileId}/link`, { session: hr })).status).toBe(403);
      const op = await signIn({ email: DEMO_STAFF.find((s) => s.role === 'claims_officer')!.email });
      expect((await api.call('GET', `/files/${fileId}/link`, { session: op })).status).toBe(200);
      expect((await api.call('GET', `/files/${fileId}/link`)).status).toBe(401);
      expect((await api.call('GET', '/files/not-a-uuid/link', { session: op })).status).toBe(404);
    });
  });
  describe('Storage objects follow their rows (the collector)', () => {
    const logs: { msg: string; data?: Record<string, unknown> }[] = [];
    const gc = () => storageGc({ pool, storage: stack.storage, log: (msg, data) => logs.push({ msg, ...(data ? { data } : {}) }) });

    it('a removed file row queues its object; the next pass deletes it from Storage', async () => {
      const owner = await signIn({ phone: DEMO_INSURED_PHONE });
      const r = await api.call('POST', '/me/claims', {
        session: owner,
        raw: await receiptForm([{ bytes: jpegWithExif(11), name: 'gc.jpg', type: 'image/jpeg' }]),
      });
      const fileId = (await attachmentOf((r.body as { id: string }).id)).id;
      expect(await stack.storage.get('receipts', fileId)).not.toBeNull();
      await pool.query(`delete from public.files where id = $1`, [fileId]);
      const queued = await pool.query(`select bucket, object_name::text as name from app.storage_gc where object_name = $1::uuid`, [fileId]);
      expect(queued.rows).toEqual([{ bucket: 'receipts', name: fileId }]);
      const pass = await gc().drain();
      expect(pass.removed).toBeGreaterThanOrEqual(1);
      expect(await stack.storage.get('receipts', fileId)).toBeNull();
      expect((await pool.query(`select 1 from app.storage_gc where object_name = $1::uuid`, [fileId])).rowCount).toBe(0);
      // Running it again does nothing (idempotent).
      expect((await gc().drain()).removed).toBe(0);
    });

    it('an object still pointed at by a row is kept even if queued', async () => {
      const live = (await pool.query(`select bucket, object_name::text as name from public.files where object_name is not null limit 1`)).rows[0] as { bucket: string; name: string };
      await pool.query(`insert into app.storage_gc (bucket, object_name) values ($1, $2::uuid)`, [live.bucket, live.name]);
      await gc().drain();
      expect(await stack.storage.get(live.bucket as 'receipts', live.name)).not.toBeNull();
    });

    it('the daily sweep deletes orphans older than a day and reports it; young objects and objects with rows stay', async () => {
      const orphan = '0000aaaa-0000-4000-8000-00000000a001';
      const young = '0000aaaa-0000-4000-8000-00000000a002';
      await stack.storage.put('documents', orphan, new TextEncoder().encode('%PDF-1.4 orphan'), 'application/pdf');
      await stack.storage.put('documents', young, new TextEncoder().encode('%PDF-1.4 young'), 'application/pdf');
      await pool.query(`update storage.objects set created_at = now() - interval '2 days' where bucket_id = 'documents' and name = $1`, [orphan]);
      logs.length = 0;
      const res = await gc().sweepOrphans();
      expect(res.removed).toBeGreaterThanOrEqual(1);
      expect(await stack.storage.get('documents', orphan)).toBeNull();
      expect(await stack.storage.get('documents', young)).not.toBeNull();
      expect(logs.find((l) => l.msg === 'storage gc: orphan sweep')?.data).toMatchObject({ removed: res.removed });
      const rowed = (await pool.query(`select bucket, object_name::text as name from public.files where object_name is not null limit 1`)).rows[0] as { bucket: string; name: string };
      expect(await stack.storage.get(rowed.bucket as 'receipts', rowed.name)).not.toBeNull();
      await stack.storage.remove('documents', young);
    });
  });
});
