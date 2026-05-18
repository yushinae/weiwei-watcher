import type { DbPool } from '../db/pool';
import type { OrderBookStore } from '../agg/orderbookStore';
import type { TradeAggregator } from '../agg/tradeAggregator';
import type { TickerStore } from '../agg/tickerStore';
import { runWithAdvisoryLock } from './scheduler';
import { buildBybitChainSnapshot } from '../agg/chainBuilder';

export function startSnapshotJobs({
  pool,
  orderbooks,
  trades,
  tickers,
}: {
  pool: DbPool;
  orderbooks: OrderBookStore;
  trades: TradeAggregator;
  tickers: TickerStore;
}) {
  const flushTrades = async () => {
    const rows = trades.drainBefore(Date.now());
    if (!rows.length) return;
    await runWithAdvisoryLock(pool, 'job:trades_1s', async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const r of rows) {
          await client.query(
            `insert into option_trades_1s
              (bucket_ts, exchange, symbol, count, buy_qty, sell_qty, vwap, min_price, max_price)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (exchange, symbol, bucket_ts) do update set
              count=excluded.count,
              buy_qty=excluded.buy_qty,
              sell_qty=excluded.sell_qty,
              vwap=excluded.vwap,
              min_price=excluded.min_price,
              max_price=excluded.max_price`,
            [
              r.bucket_ts,
              r.exchange,
              r.symbol,
              r.count,
              r.buy_qty,
              r.sell_qty,
              r.vwap,
              r.min_price,
              r.max_price,
            ],
          );
        }
        await client.query('commit');
      } catch {
        await client.query('rollback');
      } finally {
        client.release();
      }
    });
  };

  const sampleOrderbooks = async () => {
    // For now, sample only existing in-memory books
    const symbols = orderbooks.symbols();
    if (!symbols.length) return;

    await runWithAdvisoryLock(pool, 'job:orderbook_samples_1s', async () => {
      const now = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const symbol of symbols) {
          const b = orderbooks.get(symbol);
          if (!b || !b.bids.length || !b.asks.length) continue;
          const bestBid = b.bids[0]!.price;
          const bestAsk = b.asks[0]!.price;
          const mid = (bestBid + bestAsk) / 2;
          const spread = bestAsk - bestBid;
          const topN = 25;
          const bidDepth = b.bids.slice(0, topN).reduce((s, l) => s + l.size, 0);
          const askDepth = b.asks.slice(0, topN).reduce((s, l) => s + l.size, 0);
          const imb = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
          await client.query(
            `insert into orderbook_samples_1s
             (ts, exchange, symbol, best_bid, best_ask, mid, spread, bid_depth_n, ask_depth_n, imbalance_n, levels)
             values ($1,'bybit',$2,$3,$4,$5,$6,$7,$8,$9,$10)
             on conflict (exchange, symbol, ts) do nothing`,
            [
              now,
              symbol,
              bestBid,
              bestAsk,
              mid,
              spread,
              bidDepth,
              askDepth,
              imb,
              JSON.stringify({
                bids: b.bids.slice(0, 10),
                asks: b.asks.slice(0, 10),
              }),
            ],
          );
        }
        await client.query('commit');
      } catch {
        await client.query('rollback');
      } finally {
        client.release();
      }
    });
  };

  const snapshotChains = async () => {
    await runWithAdvisoryLock(pool, 'job:chain_snapshot', async () => {
      // pick a few expiries per base to avoid overloading local DB
      const bases = ['BTC', 'ETH'];
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const base of bases) {
          const expOut = await client.query(
            `select distinct expiry_ts from instruments where exchange='bybit' and base=$1 order by expiry_ts asc limit 3`,
            [base],
          );
          for (const row of expOut.rows) {
            const expiryTs = new Date(row.expiry_ts).toISOString();
            const payload = await buildBybitChainSnapshot({ pool, tickers, base, expiryTs });
            const atmIv = (() => {
              let best: { score: number; iv: number } | null = null;
              for (const s of payload.strikes as any[]) {
                for (const side of ['call', 'put'] as const) {
                  const t = s?.[side];
                  const iv = Number(t?.iv);
                  const delta = Number(t?.delta);
                  if (!Number.isFinite(iv)) continue;
                  const score = Number.isFinite(delta) ? Math.abs(Math.abs(delta) - 0.5) : 999;
                  if (!best || score < best.score) best = { score, iv };
                }
              }
              return best?.iv ?? null;
            })();
            await client.query(
              `insert into option_chain_snapshots (ts, exchange, base, expiry_ts, underlying_price, index_price, payload)
               values (now(), 'bybit', $1, $2, null, null, $3)`,
              [base, expiryTs, JSON.stringify(payload)],
            );

            await client.query(
              `insert into iv_skew_metrics (ts, exchange, base, expiry_ts, atm_iv, rr25, fly25)
               values (now(), 'bybit', $1, $2, $3, null, null)
               on conflict (exchange, base, expiry_ts, ts) do nothing`,
              [base, expiryTs, atmIv],
            );
          }
        }
        await client.query('commit');
      } catch {
        await client.query('rollback');
      } finally {
        client.release();
      }
    });
  };

  const t1 = setInterval(() => void flushTrades(), 1000);
  const t2 = setInterval(() => void sampleOrderbooks(), 1000);
  const t3 = setInterval(() => void snapshotChains(), 10_000);

  return () => {
    clearInterval(t1);
    clearInterval(t2);
    clearInterval(t3);
  };
}
