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

import { useEffect, useMemo, useState } from 'react';
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

export function useChainStream(source: DataSource, expiry: ChainExpiry | undefined): LiveTicks {
  const [ticks, setTicks] = useState<LiveTicks>({});

  // (instrument, row-key) targets for the active expiry; re-subscribe on expiry change.
  const targetSig = expiry ? `${expiry.key}:${expiry.rows.length}` : '';
  const targets = useMemo(() => {
    if (!expiry) return [] as { instrument: string; key: string }[];
    const out: { instrument: string; key: string }[] = [];
    for (const r of expiry.rows) {
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
