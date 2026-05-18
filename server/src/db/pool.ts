import pg from 'pg';
import type { Env } from '../config';

const { Pool } = pg;

export function createPool(env: Env) {
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 20_000,
  });
  return pool;
}

export type DbPool = ReturnType<typeof createPool>;

