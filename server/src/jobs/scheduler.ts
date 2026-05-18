import type { DbPool } from '../db/pool';

async function tryLock(pool: DbPool, key: string) {
  // Use hashtext to generate int4; pg_try_advisory_lock expects bigint, so cast.
  const out = await pool.query('select pg_try_advisory_lock(hashtext($1)::bigint) as ok', [key]);
  return !!out.rows?.[0]?.ok;
}

async function unlock(pool: DbPool, key: string) {
  await pool.query('select pg_advisory_unlock(hashtext($1)::bigint)', [key]);
}

export async function runWithAdvisoryLock<T>(pool: DbPool, key: string, fn: () => Promise<T>) {
  const ok = await tryLock(pool, key);
  if (!ok) return null;
  try {
    return await fn();
  } finally {
    await unlock(pool, key).catch(() => void 0);
  }
}

