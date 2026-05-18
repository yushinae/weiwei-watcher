import WebSocket from 'ws';
import type { CollectorManager } from '../../collectors/manager';
import type { OrderBookStore } from '../../agg/orderbookStore';
import type { TradeAggregator } from '../../agg/tradeAggregator';
import type { TickerStore } from '../../agg/tickerStore';

type BybitWsOpts = {
  manager: CollectorManager;
  orderbooks: OrderBookStore;
  trades: TradeAggregator;
  tickers?: TickerStore;
  // 期权 symbol 列表（建议由 instruments bootstrap 填充）
  symbols: string[];
  baseCoins: string[]; // e.g. ['BTC','ETH'] for publicTrade
};

export function startBybitWs(opts: BybitWsOpts) {
  const env = (process.env.BYBIT_ENV ?? 'testnet').toLowerCase();
  const url = env === 'mainnet' ? 'wss://stream.bybit.com/v5/public/option' : 'wss://stream-testnet.bybit.com/v5/public/option';
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    opts.manager.setState('bybit_ws', 'connecting');
    ws = new WebSocket(url);

    ws.on('open', () => {
      opts.manager.setState('bybit_ws', 'open');
      // subscribe
      const args: string[] = [];
      for (const s of opts.symbols) {
        args.push(`tickers.${s}`);
        args.push(`orderbook.25.${s}`);
      }
      for (const b of opts.baseCoins) {
        args.push(`publicTrade.${b}`);
      }
      if (args.length) {
        ws?.send(JSON.stringify({ op: 'subscribe', args }));
      }

      // ping keepalive (Bybit suggests 20s)
      pingTimer = setInterval(() => {
        try {
          ws?.send(JSON.stringify({ op: 'ping' }));
        } catch {
          // ignore
        }
      }, 20_000);
    });

    ws.on('message', (raw) => {
      opts.manager.markMessage('bybit_ws');
      try {
        const msg = JSON.parse(String(raw));

        // orderbook: { topic, type: snapshot|delta, data: { s, b, a, ts } }
        if (typeof msg?.topic === 'string' && msg.topic.startsWith('orderbook.')) {
          const symbol = msg?.data?.s as string | undefined;
          const ts = Number(msg?.ts ?? msg?.data?.ts ?? Date.now());
          const bids = (msg?.data?.b ?? []) as [string, string][];
          const asks = (msg?.data?.a ?? []) as [string, string][];
          if (symbol && msg.type === 'snapshot') opts.orderbooks.applySnapshot(symbol, ts, bids, asks);
          if (symbol && msg.type === 'delta') opts.orderbooks.applyDelta(symbol, ts, bids, asks);
          return;
        }

        // publicTrade: { topic:'publicTrade.BTC', data:[{s,S,p,v,T}] }
        if (typeof msg?.topic === 'string' && msg.topic.startsWith('publicTrade.')) {
          const arr = (msg?.data ?? []) as any[];
          for (const t of arr) {
            const symbol = String(t?.s ?? '');
            const side = String(t?.S ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell';
            const price = Number(t?.p);
            const qty = Number(t?.v);
            const ts = Number(t?.T ?? Date.now());
            if (!symbol || !Number.isFinite(price) || !Number.isFinite(qty)) continue;
            opts.trades.add({ exchange: 'bybit', symbol, side, price, qty, ts });
          }
          return;
        }

        // tickers: { topic:'tickers.SYMBOL', data:{ symbol, bid1Price, ask1Price, lastPrice, markPrice, indexPrice, markIv, greeks... } }
        if (typeof msg?.topic === 'string' && msg.topic.startsWith('tickers.') && opts.tickers) {
          const d = msg?.data ?? {};
          const symbol = String(d?.symbol ?? d?.s ?? '');
          if (!symbol) return;
          const ts = Number(d?.ts ?? msg?.ts ?? Date.now());
          opts.tickers.set({
            symbol,
            ts,
            bid: Number(d?.bid1Price ?? d?.bid1 ?? d?.b ?? NaN),
            ask: Number(d?.ask1Price ?? d?.ask1 ?? d?.a ?? NaN),
            last: Number(d?.lastPrice ?? d?.lp ?? NaN),
            mark: Number(d?.markPrice ?? d?.mp ?? NaN),
            index: Number(d?.indexPrice ?? d?.ip ?? NaN),
            iv: Number(d?.markIv ?? d?.iv ?? NaN),
            delta: d?.delta != null ? Number(d.delta) : undefined,
            gamma: d?.gamma != null ? Number(d.gamma) : undefined,
            vega: d?.vega != null ? Number(d.vega) : undefined,
            theta: d?.theta != null ? Number(d.theta) : undefined,
            oi: d?.openInterest != null ? Number(d.openInterest) : undefined,
          });
        }
      } catch (e) {
        // parse errors should not kill connection
      }
    });

    ws.on('close', () => {
      opts.manager.setState('bybit_ws', 'closed');
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      reconnectTimer = setTimeout(connect, 3000);
    });

    ws.on('error', (e) => {
      opts.manager.setError('bybit_ws', e);
    });
  };

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    ws?.close();
  };
}
