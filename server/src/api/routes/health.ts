import { Router } from 'express';
import type { Env } from '../../config';
import type { DbPool } from '../../db/pool';

export function healthRouter(env: Env, pool: DbPool) {
  const r = Router();

  r.get('/', async (_req, res) => {
    try {
      const t0 = Date.now();
      await pool.query('select 1');
      const ms = Date.now() - t0;
      res.json({ ok: true, env: env.nodeEnv, db: { ok: true, ms } });
    } catch (e: any) {
      res.status(500).json({ ok: false, env: env.nodeEnv, db: { ok: false, error: String(e?.message ?? e) } });
    }
  });

  return r;
}

