/*
 * The separate HMAC of the phone's last 4 digits (stage 1.5, store/sql/migrationsPhoneTail.ts) for rows written before
 * the column existed: the worker fills it on every pass, up to `limit` rows (the key is the API's, not the database's).
 * Rows written since get it from the repositories with the phone. Idempotent: only rows without it are touched.
 */
import type pg from 'pg';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { tailInput } from '@mig/domain/store/sql/physical';

export async function backfillPhoneTails(pool: pg.Pool, crypto: PiiCrypto, limit = 500): Promise<number> {
  const { rows } = await pool.query<{ id: string; phone_enc: Uint8Array; phone_key_ver: number }>(
    `select id::text as id, phone_enc, phone_key_ver from public.insured where phone_enc is not null and phone_tail_hmac is null limit $1`,
    [limit],
  );
  let n = 0;
  for (const r of rows) {
    const tail = tailInput(await crypto.open(r.phone_enc, r.phone_key_ver));
    if (!tail) continue;
    await pool.query(`update public.insured set phone_tail_hmac = $2 where id = $1::uuid and phone_tail_hmac is null`, [r.id, await crypto.hmac(tail)]);
    n += 1;
  }
  return n;
}
