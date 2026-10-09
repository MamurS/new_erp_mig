/*
 * Storage objects never outlive their file rows (BACKEND_SPEC §8):
 * - a removed or replaced row queues its object in `app.storage_gc` (trigger of migration …_storage_gc.sql: deletes,
 *   cascades and the rollback of a portfolio transfer alike); every worker pass deletes the queued objects;
 * - the daily sweep deletes orphans: objects of the file buckets older than a day with no row (an upload whose
 *   transaction rolled back, rows emptied by the demo reset) and reports what it did in the log.
 * An object is deleted only while no row points at it (a row may have been written again with the same name).
 */
import type pg from 'pg';
import type { BlobStore, BucketId } from '@mig/domain/store/blob';
import { BUCKETS } from '@mig/domain/store/sql/migrationsAuth';

/** Buckets of file rows; help assets are not rows. */
export const FILE_BUCKETS = BUCKETS.map((b) => b.id).filter((b) => b !== 'help-assets');

export const ORPHAN_MIN_AGE_MS = 24 * 3600_000;

export interface StorageGcOptions {
  pool: pg.Pool;
  storage: Pick<BlobStore, 'remove'>;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  /** Objects taken per pass. */
  batch?: number;
}

export interface StorageGc {
  /** Deletes the queued objects; the number deleted. */
  drain(): Promise<{ removed: number; failed: number }>;
  /** Deletes objects of the file buckets older than `minAgeMs` that no row points at. */
  sweepOrphans(minAgeMs?: number): Promise<{ removed: number; failed: number }>;
}

const LIVE = `exists (select 1 from public.files f where f.bucket = $1 and f.object_name = $2::uuid)`;

export function storageGc(o: StorageGcOptions): StorageGc {
  const log = o.log ?? (() => undefined);
  const batch = o.batch ?? 200;

  async function removeIfDead(bucket: string, name: string): Promise<boolean> {
    const { rows } = await o.pool.query<{ live: boolean }>(`select ${LIVE} as live`, [bucket, name]);
    if (rows[0]?.live) return false;
    await o.storage.remove(bucket as BucketId, name);
    return true;
  }

  return {
    async drain() {
      let removed = 0;
      let failed = 0;
      const { rows } = await o.pool.query<{ id: string; bucket: string; name: string }>(
        `select id::text, bucket, object_name::text as name from app.storage_gc order by id limit $1`,
        [batch],
      );
      for (const r of rows) {
        try {
          if (await removeIfDead(r.bucket, r.name)) removed++;
          await o.pool.query(`delete from app.storage_gc where id = $1::bigint`, [r.id]);
        } catch (e) {
          failed++;
          const why = e instanceof Error ? e.message.slice(0, 300) : 'error';
          await o.pool.query(`update app.storage_gc set attempts = attempts + 1, last_error = $2 where id = $1::bigint`, [r.id, why]);
        }
      }
      if (removed || failed) log('storage gc: queued objects', { removed, failed });
      return { removed, failed };
    },

    async sweepOrphans(minAgeMs = ORPHAN_MIN_AGE_MS) {
      let removed = 0;
      let failed = 0;
      let rows: { bucket: string; name: string }[];
      try {
        ({ rows } = await o.pool.query<{ bucket: string; name: string }>(
          `select o.bucket_id as bucket, o.name
             from storage.objects o
            where o.bucket_id = any($1::text[])
              and o.created_at < now() - make_interval(secs => $2::double precision / 1000)
              and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and not exists (select 1 from public.files f where f.bucket = o.bucket_id and f.object_name = o.name::uuid)
            order by o.created_at
            limit $3`,
          [FILE_BUCKETS, minAgeMs, batch * 5],
        ));
      } catch {
        return { removed, failed }; // no Storage schema (a plain Postgres)
      }
      for (const r of rows) {
        try {
          if (await removeIfDead(r.bucket, r.name)) removed++;
        } catch {
          failed++;
        }
      }
      log('storage gc: orphan sweep', { scanned: rows.length, removed, failed });
      return { removed, failed };
    },
  };
}
