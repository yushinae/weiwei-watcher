import { Router } from 'express';
import type { DbPool } from '../../db/pool';

export function marketRouter(pool: DbPool) {
  const r = Router();

  // 预留：instruments 查询（后续接入 bootstrap）
  r.get('/instruments', async (req, res) => {
    const exchange = (req.query.exchange as string | undefined) ?? null;
    const base = (req.query.base as string | undefined) ?? null;
    const expiry = (req.query.expiry as string | undefined) ?? null;

    const params: any[] = [];
    const where: string[] = [];
    if (exchange) { params.push(exchange); where.push(`exchange = $${params.length}`); }
    if (base) { params.push(base); where.push(`base = $${params.length}`); }
    if (expiry) { params.push(expiry); where.push(`expiry_ts = $${params.length}`); }

    const sql = `select * from instruments ${where.length ? `where ${where.join(' and ')}` : ''} order by expiry_ts asc, strike asc limit 5000`;
    const out = await pool.query(sql, params);
    res.json({ items: out.rows });
  });

  // 预留：期权链最新快照（后续 jobs 落库后可直接用）
  r.get('/options/chain/latest', async (req, res) => {
    const exchange = String(req.query.exchange ?? 'bybit');
    const base = String(req.query.base ?? 'BTC');
    let expiry = String(req.query.expiry ?? '');
    if (!expiry) {
      // 若未指定 expiry，则自动选择最近到期日（便于前端“开箱即用”）
      const e = await pool.query(
        `select distinct expiry_ts from instruments where exchange=$1 and base=$2 order by expiry_ts asc limit 1`,
        [exchange, base],
      );
      expiry = e.rows?.[0]?.expiry_ts ? new Date(e.rows[0].expiry_ts).toISOString() : '';
    }
    if (!expiry) return res.status(404).json({ error: 'no expiry available (instruments empty)' });

    const out = await pool.query(
      `select * from option_chain_snapshots where exchange=$1 and base=$2 and expiry_ts=$3 order by ts desc limit 1`,
      [exchange, base, expiry],
    );
    res.json(out.rows[0] ?? null);
  });

  // expiry 列表：用于前端选择器（distinct）
  r.get('/options/expiries', async (req, res) => {
    const exchange = String(req.query.exchange ?? 'bybit');
    const base = String(req.query.base ?? 'BTC');
    const out = await pool.query(
      `select distinct expiry_ts from instruments where exchange=$1 and base=$2 order by expiry_ts asc limit 50`,
      [exchange, base],
    );
    res.json({ items: out.rows.map((r) => new Date(r.expiry_ts).toISOString()) });
  });

  return r;
}
