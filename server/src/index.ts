import http from 'node:http';
import process from 'node:process';
import { loadEnv } from './config';
import { createPool } from './db/pool';
import { createApp } from './app';
import { CollectorManager } from './collectors/manager';
import { OrderBookStore } from './agg/orderbookStore';
import { TradeAggregator } from './agg/tradeAggregator';
import { TickerStore } from './agg/tickerStore';
import { startBybitWs } from './exchange/bybit/ws';
import { startDeribitWs } from './exchange/deribit/ws';
import { startSnapshotJobs } from './jobs/snapshots';
import { InstrumentRegistry } from './collectors/instrumentRegistry';

async function main() {
  const env = loadEnv();
  const pool = createPool(env);

  const collectors = new CollectorManager(pool);
  collectors.ensure('bybit_ws', env.enableCollectors ? 'connecting' : 'disabled');
  collectors.ensure('deribit_ws', env.enableCollectors ? 'connecting' : 'disabled');
  collectors.startFlush(1000);

  const orderbooks = new OrderBookStore();
  const trades = new TradeAggregator();
  const tickers = new TickerStore();
  const instruments = new InstrumentRegistry(pool);

  let stopBybit: (() => void) | null = null;
  let stopDeribit: (() => void) | null = null;
  if (env.enableCollectors) {
    // Deribit: start minimal WS now (subscription maintenance is incremental)
    void instruments.bootstrapDeribit(env.deribitCurrencies).catch((e) => collectors.setError('deribit_ws', e));
    stopDeribit = startDeribitWs({ manager: collectors, currencies: env.deribitCurrencies });

    // Bybit: if BYBIT_SYMBOLS not provided, bootstrap instruments then auto-pick a small universe and subscribe
    const startBybit = async () => {
      try {
        await instruments.bootstrapBybit(env.bybitBaseCoins);
        let symbols = env.bybitSymbols;
        if (!symbols.length) {
          // auto-select: per base, earliest expiries & strikes (cap size to protect local machine)
          const capPerBase = 120;
          const picked: string[] = [];
          for (const base of env.bybitBaseCoins) {
            const out = await pool.query(
              `select symbol from instruments
               where exchange='bybit' and base=$1
               order by expiry_ts asc, strike asc
               limit $2`,
              [base, capPerBase],
            );
            picked.push(...out.rows.map((r) => String(r.symbol)));
          }
          symbols = picked;
        }

        if (symbols.length) {
          collectors.setState('bybit_ws', 'connecting');
          stopBybit = startBybitWs({
            manager: collectors,
            orderbooks,
            trades,
            tickers,
            symbols,
            baseCoins: env.bybitBaseCoins,
          });
        } else {
          collectors.setState('bybit_ws', 'degraded');
          collectors.setError('bybit_ws', new Error('BYBIT_SYMBOLS 为空且 instruments bootstrap 未获取到可订阅的期权 symbol'));
        }
      } catch (e) {
        collectors.setError('bybit_ws', e);
      }
    };

    void startBybit();
  }

  const stopJobs = startSnapshotJobs({ pool, orderbooks, trades, tickers });

  const statusSource = async () => {
    return { ok: true, sources: collectors.snapshot(), ts: new Date().toISOString() };
  };

  const app = createApp(env, { pool, statusSource });
  const server = http.createServer(app);

  server.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] listening on http://localhost:${env.port}`);
  });

  const shutdown = async () => {
    server.close();
    stopBybit?.();
    stopDeribit?.();
    stopJobs();
    collectors.stopFlush();
    await pool.end().catch(() => void 0);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
