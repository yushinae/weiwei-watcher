import type { DbPool } from '../db/pool';
import type { TickerStore } from './tickerStore';

export async function buildBybitChainSnapshot(params: {
  pool: DbPool;
  tickers: TickerStore;
  base: string;
  expiryTs: string;
}) {
  const { pool, tickers, base, expiryTs } = params;
  const out = await pool.query(
    `select symbol, strike, option_type from instruments where exchange='bybit' and base=$1 and expiry_ts=$2 order by strike asc`,
    [base, expiryTs],
  );

  const strikes = new Map<number, any>();
  for (const r of out.rows) {
    const strike = Number(r.strike);
    const optType = String(r.option_type) as 'C' | 'P';
    const symbol = String(r.symbol);
    const t = tickers.get(symbol);
    const entry = strikes.get(strike) ?? { K: strike, call: null, put: null };
    const payload = t
      ? {
          symbol,
          bid: Number.isFinite(t.bid) ? t.bid : null,
          ask: Number.isFinite(t.ask) ? t.ask : null,
          mark: Number.isFinite(t.mark) ? t.mark : null,
          iv: Number.isFinite(t.iv) ? t.iv : null,
          delta: Number.isFinite(t.delta) ? t.delta : null,
          gamma: Number.isFinite(t.gamma) ? t.gamma : null,
          vega: Number.isFinite(t.vega) ? t.vega : null,
          theta: Number.isFinite(t.theta) ? t.theta : null,
          oi: Number.isFinite(t.oi) ? t.oi : null,
        }
      : { symbol, missing: true };

    if (optType === 'C') entry.call = payload;
    else entry.put = payload;
    strikes.set(strike, entry);
  }

  return {
    base,
    expiryTs,
    strikes: [...strikes.values()],
  };
}

