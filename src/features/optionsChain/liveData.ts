// ═══════════════════════════════════════════════════════════════════════════════
// Live spot price for the options chain — Deribit index via the shared WebSocket.
//
// The Deribit price index (`deribit_price_index.btc_usd` / `eth_usd`) is the same
// USD reference both Deribit and Bybit options are struck against, so one live feed
// drives the spot marker / ATM band / 标记 for either data source.
//
// Pushes arrive ~10×/s; we throttle React updates to 1 Hz to keep the chain smooth
// without burning CPU (re-rendering the whole grid on every tick would be wasteful).
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { DERIBIT_WS } from '../../registry/data/ws';
import { BYBIT_OPTION_WS } from './bybitOptionWs';
import type { Coin, DataSource, ChainExpiry, Side } from './chainModel';

export function useLiveSpot(coin: Coin): number | null {
  const [spot, setSpot] = useState<number | null>(null);

  useEffect(() => {
    setSpot(null);
    const channel = `deribit_price_index.${coin === 'ETH' ? 'eth' : 'btc'}_usd`;
    let latest: number | null = null;

    const unsub = DERIBIT_WS.subscribe<{ price: number }>(channel, d => {
      if (Number.isFinite(d?.price)) latest = d.price;
    });
    // Flush to React at 1 Hz (smooth enough for a price marker, cheap on CPU).
    const flush = setInterval(() => {
      if (latest != null) setSpot(latest);
    }, 1000);

    return () => { unsub(); clearInterval(flush); };
  }, [coin]);

  return spot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live option-chain stream — subscribes the ACTIVE expiry's option tickers over WS
// and returns a per-strike overlay (merged onto the REST chain by the view).
//   • Deribit:  DERIBIT_WS  ticker.{instrument}.100ms     (coin-quoted → ×underlying)
//   • Bybit:    BYBIT_OPTION_WS  tickers.{symbol}          (USDT-quoted, as-is)
// Re-renders throttled to 1 Hz; degrades gracefully (REST chain shows if WS is empty).
// ─────────────────────────────────────────────────────────────────────────────

export type LiveTicks = Record<string, Partial<Side>>; // key: `${'C'|'P'}-${strike}`

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

function normalizeBybit(d: Record<string, unknown>): Partial<Side> | null {
  const out: Partial<Side> = {};
  const mark = num(d.markPrice); if (mark != null) out.mark = mark;
  const miv = num((d.markIv ?? d.markPriceIv) as unknown); if (miv != null) out.iv = miv * 100;
  const bid = num((d.bidPrice ?? d.bid1Price) as unknown); if (bid != null) out.bid = bid > 0 ? bid : null;
  const ask = num((d.askPrice ?? d.ask1Price) as unknown); if (ask != null) out.ask = ask > 0 ? ask : null;
  const biv = num((d.bidIv ?? d.bid1Iv) as unknown); if (biv != null) out.ivBid = biv * 100;
  const aiv = num((d.askIv ?? d.ask1Iv) as unknown); if (aiv != null) out.ivAsk = aiv * 100;
  const dl = num(d.delta); if (dl != null) out.delta = dl;
  const gm = num(d.gamma); if (gm != null) out.gamma = gm;
  const vg = num(d.vega); if (vg != null) out.vega = vg;
  const th = num(d.theta); if (th != null) out.theta = th;
  const oi = num(d.openInterest); if (oi != null) out.oi = oi;
  const vol = num(d.volume24h); if (vol != null) out.size = vol;
  return Object.keys(out).length ? out : null;
}

function normalizeDeribit(d: Record<string, any>): Partial<Side> | null {
  const fwd = num(d.underlying_price);
  const toUsd = (c: unknown) => { const n = num(c); return n != null && fwd != null && fwd > 0 ? n * fwd : n; };
  const quote = (c: unknown) => { const n = num(c); return n != null && n > 0 && fwd != null && fwd > 0 ? n * fwd : null; };
  const g = (d.greeks ?? d) as Record<string, unknown>;
  const out: Partial<Side> = {};
  const mark = toUsd(d.mark_price); if (mark != null) out.mark = mark;
  const iv = num(d.mark_iv); if (iv != null) out.iv = iv;
  out.bid = quote(d.best_bid_price);
  out.ask = quote(d.best_ask_price);
  const dl = num(g.delta); if (dl != null) out.delta = dl;
  const gm = num(g.gamma); if (gm != null) out.gamma = gm;
  const vg = num(g.vega); if (vg != null) out.vega = vg;
  const th = num(g.theta); if (th != null) out.theta = th;
  const oi = num(d.open_interest); if (oi != null) out.oi = oi;
  const vol = num(d.stats?.volume); if (vol != null) out.size = vol;
  return Object.keys(out).length ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 真实多档盘口 —— 替代 TradingPanel 旧的"示意盘口"（genBook 模拟深度）。
//   • Deribit:  public/get_order_book（option 报价为币本位 → ×underlying 折 USD）
//   • Bybit:    /bybit-api/v5/market/orderbook（已是 USDT≈USD）
// REST 轮询 1.5s：期权盘口变化慢、且多档本就薄，足够；document.hidden 时暂停。
// 注意：期权盘口普遍很薄，多数行权价只有 1~3 档，空时返回 real=false（UI 显示"暂无"）。
// ─────────────────────────────────────────────────────────────────────────────
export interface BookLvl { price: number; size: number; total: number }

export function useOrderBook(instrument: string | undefined, source: DataSource, spot: number) {
  const [book, setBook] = useState<{ asks: BookLvl[]; bids: BookLvl[]; real: boolean }>({ asks: [], bids: [], real: false });
  const spotRef = useRef(spot);
  spotRef.current = spot;

  useEffect(() => {
    if (!instrument) { setBook({ asks: [], bids: [], real: false }); return; }
    let alive = true;

    // 排序 + 累计量；asks 升序（最优卖在前）、bids 降序（最优买在前），各取前 10 档
    const mk = (arr: [number, number][], desc: boolean): BookLvl[] => {
      const s = arr.filter(([p, sz]) => p > 0 && sz > 0).sort((a, b) => (desc ? b[0] - a[0] : a[0] - b[0])).slice(0, 10);
      let cum = 0;
      return s.map(([price, size]) => { cum += size; return { price, size, total: cum }; });
    };

    const poll = async () => {
      if (document.hidden) return;
      try {
        let rawBids: [number, number][] = [];
        let rawAsks: [number, number][] = [];
        if (source === 'bybit') {
          const r = await fetch(`/bybit-api/v5/market/orderbook?category=option&symbol=${encodeURIComponent(instrument)}&limit=25`);
          const j = await r.json();
          const res = j?.result ?? {};
          rawBids = (res.b ?? []).map((x: string[]) => [+x[0], +x[1]] as [number, number]);
          rawAsks = (res.a ?? []).map((x: string[]) => [+x[0], +x[1]] as [number, number]);
        } else {
          const r = await fetch(`https://www.deribit.com/api/v2/public/get_order_book?instrument_name=${encodeURIComponent(instrument)}&depth=10`);
          const j = await r.json();
          const res = j?.result ?? {};
          const u = (res.underlying_price ?? res.index_price ?? spotRef.current) || 1; // 币价→USD
          rawBids = (res.bids ?? []).map((x: number[]) => [x[0] * u, x[1]] as [number, number]);
          rawAsks = (res.asks ?? []).map((x: number[]) => [x[0] * u, x[1]] as [number, number]);
        }
        const asks = mk(rawAsks, false);
        const bids = mk(rawBids, true);
        if (alive) setBook({ asks, bids, real: asks.length > 0 || bids.length > 0 });
      } catch {
        if (alive) setBook({ asks: [], bids: [], real: false });
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 1500);
    return () => { alive = false; clearInterval(id); };
  }, [instrument, source]);

  return book;
}

// ── 近期成交（市场最近成交流）—— REST 轮询 3s ───────────────────────────────────
//   • Deribit:  public/get_last_trades_by_instrument（币价 ×index 折 USD）
//   • Bybit:    /bybit-api/v5/market/recent-trade
export interface RecentTrade { price: number; size: number; side: 'buy' | 'sell'; ts: number }

export function useRecentTrades(instrument: string | undefined, source: DataSource, spot: number) {
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const spotRef = useRef(spot);
  spotRef.current = spot;

  useEffect(() => {
    if (!instrument) { setTrades([]); return; }
    let alive = true;

    const poll = async () => {
      if (document.hidden) return;
      try {
        let out: RecentTrade[] = [];
        if (source === 'bybit') {
          const r = await fetch(`/bybit-api/v5/market/recent-trade?category=option&symbol=${encodeURIComponent(instrument)}&limit=30`);
          const j = await r.json();
          const list: Array<Record<string, unknown>> = j?.result?.list ?? [];
          out = list.map(t => ({ price: +(t.price as string), size: +(t.size as string), side: (t.side as string) === 'Buy' ? 'buy' : 'sell', ts: +(t.time as string) }));
        } else {
          const r = await fetch(`https://www.deribit.com/api/v2/public/get_last_trades_by_instrument?instrument_name=${encodeURIComponent(instrument)}&count=30&sorting=desc`);
          const j = await r.json();
          const list: Array<Record<string, any>> = j?.result?.trades ?? [];
          out = list.map(t => { const u = (t.index_price ?? spotRef.current) || 1; return { price: (Number(t.price) || 0) * u, size: Number(t.amount) || 0, side: t.direction === 'buy' ? 'buy' as const : 'sell' as const, ts: Number(t.timestamp) || 0 }; });
        }
        out = out.filter(t => t.price > 0 && Number.isFinite(t.price)).sort((a, b) => b.ts - a.ts).slice(0, 30);
        if (alive) setTrades(out);
      } catch { if (alive) setTrades([]); }
    };

    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => { alive = false; clearInterval(id); };
  }, [instrument, source]);

  return trades;
}

export function useChainStream(source: DataSource, expiry: ChainExpiry | undefined): LiveTicks {
  const [ticks, setTicks] = useState<LiveTicks>({});

  // (instrument, row-key) targets for the active expiry; re-subscribe on expiry change.
  const targetSig = expiry ? `${expiry.key}:${expiry.rows.length}` : '';
  const targets = useMemo(() => {
    if (!expiry) return [] as { instrument: string; key: string }[];
    const rows = expiry.rows;
    // 只订阅 ATM 附近的行权价：远端深 OTM/ITM 基本不动，REST 快照足够。
    // 这能把"几十路 .100ms 实时流"砍到 ~33 行（发烫主因之一）。ATM 用行索引锁定 → 不随现价抖动重订阅。
    const atm = rows.findIndex(r => r.isATM);
    const center = atm >= 0 ? atm : Math.floor(rows.length / 2);
    const K = 16; // ATM ± 16 档（覆盖可见窗口 + 余量）
    const lo = Math.max(0, center - K), hi = Math.min(rows.length, center + K + 1);
    const out: { instrument: string; key: string }[] = [];
    for (let i = lo; i < hi; i++) {
      const r = rows[i];
      if (r.call.instrument) out.push({ instrument: r.call.instrument, key: `C-${r.strike}` });
      if (r.put.instrument) out.push({ instrument: r.put.instrument, key: `P-${r.strike}` });
    }
    return out;
  }, [targetSig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (targets.length === 0) { setTicks({}); return; }
    const buf: LiveTicks = {};
    let dirty = false;
    let unsubs: Array<() => void> = [];

    // Subscribe / unsubscribe the per-option ticker channels. Paused while the tab
    // is hidden — those subs are the heavy part (Deribit .100ms × dozens of strikes),
    // so dropping them while not visible saves CPU / battery.
    const subscribe = () => {
      if (unsubs.length) return;
      for (const { instrument, key } of targets) {
        if (source === 'bybit') {
          unsubs.push(BYBIT_OPTION_WS.subscribe<Record<string, unknown>>(`tickers.${instrument}`, d => {
            const s = normalizeBybit(d); if (s) { buf[key] = { ...buf[key], ...s }; dirty = true; }
          }));
        } else {
          unsubs.push(DERIBIT_WS.subscribe<Record<string, any>>(`ticker.${instrument}.100ms`, d => {
            const s = normalizeDeribit(d); if (s) { buf[key] = { ...buf[key], ...s }; dirty = true; }
          }));
        }
      }
    };
    const unsubscribe = () => { unsubs.forEach(u => u()); unsubs = []; };
    const onVisibility = () => { if (document.hidden) unsubscribe(); else subscribe(); };

    if (!document.hidden) subscribe();
    document.addEventListener('visibilitychange', onVisibility);

    const flush = setInterval(() => { if (!document.hidden && dirty) { dirty = false; setTicks({ ...buf }); } }, 1000);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(flush);
      setTicks({});
    };
  }, [source, targets]);

  return ticks;
}
