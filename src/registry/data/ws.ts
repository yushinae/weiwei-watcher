import { useState, useEffect, useRef } from 'react';
import type { Coin } from '../../features/monitor/types';
import { subscribeData, _shouldSkip, _registerWSPauseResume } from './poller';
import { DERIBIT_CACHE, fetchDeribitHistory, HIST_TTL, type HistoryData } from './deribit';
import { processPremiumFlow, processLargeTrades } from './store';
import { BaseWS } from '../../lib/baseWs';

// ═══════════════════════════════════════════════════════════════════════════════
// DeribitWS — singleton WebSocket manager
// ═══════════════════════════════════════════════════════════════════════════════

export type { WsStatus } from '../../lib/baseWs';

export class DeribitWS extends BaseWS {
  private rpcPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private msgId = 0;

  constructor() {
    super({ pingMs: 15_000 }); // Deribit heartbeat (public/test) every 15s
    this.feedKey = 'ws-deribit'; // 上报到数据新鲜度护栏
  }

  connect(): void { this.openSocket(); }
  disconnect(): void { this.closeSocket(); }
  pause(): void  { this.disconnect(); }
  resume(): void { this.connect(); }

  async rpc<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 12_000): Promise<T> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) this.connect();
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws open timeout')), 5_000);
        const onOpen = () => { clearTimeout(t); this.ws?.removeEventListener('open', onOpen); resolve(); };
        this.ws!.addEventListener('open', onOpen);
      });
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('ws not open');
    const id = ++this.msgId;
    const promise = new Promise<T>((resolve, reject) => {
      this.rpcPending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      setTimeout(() => {
        if (this.rpcPending.has(id)) {
          this.rpcPending.delete(id);
          reject(new Error('rpc timeout'));
        }
      }, timeoutMs);
    });
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return promise;
  }

  // ── template hooks ──────────────────────────────────────────────────────────

  protected url(): string { return 'wss://www.deribit.com/ws/api/v2'; }

  protected handleOpen(): void {
    this.setStatus('connected');
    this.startPing();
    this.resubscribeAll();
  }

  protected handleMessage(raw: string): void {
    let msg: {
      method?: string; params?: { channel: string; data: unknown };
      id?: number; error?: { message?: string }; result?: unknown;
    };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.method === 'subscription' && msg.params) {
      this.dispatch(msg.params.channel, msg.params.data);
    } else if (typeof msg.id === 'number' && this.rpcPending.has(msg.id)) {
      const p = this.rpcPending.get(msg.id)!;
      this.rpcPending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'));
      else p.resolve(msg.result);
    }
  }

  protected sendSubscribe(channel: string): void {
    this.send({ method: 'public/subscribe', params: { channels: [channel] } });
  }
  protected sendUnsubscribe(channel: string): void {
    this.send({ method: 'public/unsubscribe', params: { channels: [channel] } });
  }
  protected sendPing(): void { this.send({ method: 'public/test' }); }

  // Deribit frames are JSON-RPC: wrap every outgoing message with id + jsonrpc.
  private send(payload: object): void {
    this.rawSend({ jsonrpc: '2.0', id: ++this.msgId, ...payload });
  }
}

export const DERIBIT_WS = new DeribitWS();
_registerWSPauseResume(
  () => DERIBIT_WS.pause(),
  () => DERIBIT_WS.resume(),
);
if (typeof document !== 'undefined') DERIBIT_WS.connect();

export const WS_FLUSH_MS = 500;

// ═══════════════════════════════════════════════════════════════════════════════
// Raw option trade type (shared between WS stream and process functions)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RawOptionTrade {
  id: string;
  instrument: string;
  strike: number;
  expiry: string;
  optType: 'C' | 'P';
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  iv: number;
  indexPrice: number;
  premiumUSD: number;
  notionalUSD: number;
  ts: number;
}

export interface BlockTrade {
  tradeId: string;
  instrument: string;
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  iv: number;
  indexPrice: number;
  ts: number;
  strike: number;
  expiry: string;
  optType: 'C' | 'P';
  notionalUSD: number;
  premiumUSD: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ticker snapshot
// ═══════════════════════════════════════════════════════════════════════════════

export interface TickerSnapshot {
  spot: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  dvol: number;
  fundingAnn: number;
  optOI_M: number;
  optVol24h_M: number;
}

export const TICKER_CACHE = new Map<string, { data: TickerSnapshot; ts: number }>();

export function useTickerSnapshotWS(coin: Coin): TickerSnapshot | null {
  const partialRef = useRef<{
    spot?: number; dvol?: number; change24hPct?: number;
    high24h?: number; low24h?: number; fundingAnn?: number;
  }>({});
  const pendingRef   = useRef<TickerSnapshot | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snap, setSnap] = useState<TickerSnapshot | null>(() => TICKER_CACHE.get(coin)?.data ?? null);

  useEffect(() => {
    partialRef.current = {};
    pendingRef.current = null;
    let alive = true;
    const idx = coin === 'BTC' ? 'btc_usd' : 'eth_usd';
    const cur = coin === 'BTC' ? 'BTC' : 'ETH';

    const tryEmit = () => {
      const s = partialRef.current;
      if (s.spot === undefined) return;
      const cached = DERIBIT_CACHE.get(coin);
      const spot = s.spot;
      const t: TickerSnapshot = {
        spot,
        dvol:         s.dvol         ?? cached?.data.dvol30 ?? 0,
        change24hPct: s.change24hPct ?? 0,
        high24h:      s.high24h      ?? spot,
        low24h:       s.low24h       ?? spot,
        fundingAnn:   s.fundingAnn   ?? 0,
        optOI_M:     cached ? (cached.data.totalOptOI * spot) / 1e6 : 0,
        optVol24h_M: cached ? cached.data.totalOptVol24hUSD / 1e6   : 0,
      };
      TICKER_CACHE.set(coin, { data: t, ts: Date.now() });
      pendingRef.current = t;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          if (alive && pendingRef.current && !_shouldSkip()) setSnap(pendingRef.current);
        }, WS_FLUSH_MS);
      }
    };

    const u1 = DERIBIT_WS.subscribe<{ price: number }>(
      `deribit_price_index.${idx}`,
      d => { partialRef.current.spot = d.price; tryEmit(); },
    );
    const u2 = DERIBIT_WS.subscribe<{ volatility: number }>(
      `deribit_volatility_index.${idx}`,
      d => { partialRef.current.dvol = d.volatility; tryEmit(); },
    );
    interface PerpTicker {
      current_funding?: number;
      stats?: { price_change?: number; high?: number; low?: number };
    }
    const u3 = DERIBIT_WS.subscribe<PerpTicker>(
      `ticker.${cur}-PERPETUAL.100ms`,
      d => {
        partialRef.current.fundingAnn   = (d.current_funding ?? 0) * 3 * 365 * 100;
        const st = d.stats ?? {};
        if (st.price_change !== undefined) partialRef.current.change24hPct = st.price_change;
        if (st.high !== undefined)         partialRef.current.high24h      = st.high;
        if (st.low  !== undefined)         partialRef.current.low24h       = st.low;
        tryEmit();
      },
    );

    return () => {
      alive = false;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      u1(); u2(); u3();
    };
  }, [coin]);

  return snap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Option trades WS
// ═══════════════════════════════════════════════════════════════════════════════

export function useOptionTradesWS(coin: Coin): RawOptionTrade[] {
  const bufRef       = useRef<RawOptionTrade[]>([]);
  const seenRef      = useRef(new Set<string>());
  const dirtyRef     = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trades, setTrades] = useState<RawOptionTrade[]>([]);

  useEffect(() => {
    bufRef.current  = [];
    seenRef.current.clear();
    dirtyRef.current = false;
    let alive = true;
    const cur = coin === 'BTC' ? 'BTC' : 'ETH';

    interface RawTrade {
      trade_id: string;
      instrument_name: string;
      direction: 'buy' | 'sell';
      amount?: number;
      price?: number;
      iv?: number;
      index_price?: number;
      timestamp: number;
    }
    const unsub = DERIBIT_WS.subscribe<RawTrade[]>(
      `trades.option.${cur}.100ms`,
      (batch) => {
        if (!alive) return;
        const newTrades: RawOptionTrade[] = [];
        for (const t of (Array.isArray(batch) ? batch : [])) {
          if (seenRef.current.has(t.trade_id)) continue;
          seenRef.current.add(t.trade_id);
          const parts = t.instrument_name.split('-');
          if (parts.length !== 4) continue;
          const ip = t.index_price ?? 1, amt = t.amount ?? 0, prc = t.price ?? 0;
          newTrades.push({
            id: t.trade_id, instrument: t.instrument_name,
            strike: Number(parts[2]), expiry: parts[1],
            optType: parts[3] === 'C' ? 'C' : 'P',
            direction: t.direction === 'buy' ? 'buy' : 'sell',
            amount: amt, price: prc, iv: t.iv ?? 0, indexPrice: ip,
            premiumUSD: prc * amt * ip, notionalUSD: amt * ip,
            ts: t.timestamp,
          });
        }
        if (newTrades.length === 0) return;
        if (seenRef.current.size > 5000) {
          const arr = [...seenRef.current];
          arr.slice(0, arr.length - 3000).forEach(id => seenRef.current.delete(id));
        }
        const updated = [...newTrades, ...bufRef.current].slice(0, 2000);
        bufRef.current = updated;
        processLargeTrades(coin, updated, 0);
        processPremiumFlow(coin, updated);
        dirtyRef.current = true;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (alive && dirtyRef.current && !_shouldSkip()) { dirtyRef.current = false; setTrades([...bufRef.current]); }
          }, WS_FLUSH_MS);
        }
      },
    );
    return () => {
      alive = false;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      unsub();
    };
  }, [coin]);

  return trades;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orderbook WS
// ═══════════════════════════════════════════════════════════════════════════════

export type OBEntry = [number, number];

export function useOrderbookWS(coin: Coin): { bids: OBEntry[]; asks: OBEntry[]; mark: number; spread: number } | null {
  const bidsMap       = useRef(new Map<number, number>());
  const asksMap       = useRef(new Map<number, number>());
  const pendingMarkRef = useRef<number | undefined>(undefined);
  const dirtyRef      = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ob, setOb] = useState<{ bids: OBEntry[]; asks: OBEntry[]; mark: number; spread: number } | null>(null);

  useEffect(() => {
    bidsMap.current.clear();
    asksMap.current.clear();
    dirtyRef.current = false;
    pendingMarkRef.current = undefined;
    let alive = true;
    const inst = coin === 'BTC' ? 'BTC-PERPETUAL' : 'ETH-PERPETUAL';

    const applyChange = (map: Map<number, number>, levels: [string, number, number][]) => {
      for (const [action, price, amount] of levels) {
        if (action === 'delete' || amount === 0) map.delete(price);
        else map.set(price, amount);
      }
    };

    type BookSnapshot = { type: 'snapshot'; bids: [string, number, number][]; asks: [string, number, number][]; mark_price?: number };
    type BookChange   = { type: 'change';   bids: [string, number, number][]; asks: [string, number, number][]; mark_price?: number };
    const unsub = DERIBIT_WS.subscribe<BookSnapshot | BookChange>(
      `book.${inst}.100ms`,
      (data) => {
        if (!alive) return;
        if (data.type === 'snapshot') {
          bidsMap.current.clear(); asksMap.current.clear();
          // Deribit book levels are [action, price, amount] triples in BOTH snapshot
          // and change frames — skip the action element (matches applyChange below).
          for (const [, p, s] of (data.bids ?? [])) { if (s > 0) bidsMap.current.set(p, s); }
          for (const [, p, s] of (data.asks ?? [])) { if (s > 0) asksMap.current.set(p, s); }
        } else {
          applyChange(bidsMap.current, data.bids ?? []);
          applyChange(asksMap.current, data.asks ?? []);
        }
        if (data.mark_price !== undefined) pendingMarkRef.current = data.mark_price;
        dirtyRef.current = true;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (!alive || !dirtyRef.current || _shouldSkip()) return;
            dirtyRef.current = false;
            const bids: OBEntry[] = [...bidsMap.current.entries()].sort((a, b) => b[0] - a[0]).slice(0, 15);
            const asks: OBEntry[] = [...asksMap.current.entries()].sort((a, b) => a[0] - b[0]).slice(0, 15);
            const mark   = pendingMarkRef.current ?? (bids[0]?.[0] ?? 0);
            const spread = bids.length && asks.length ? asks[0][0] - bids[0][0] : 0;
            setOb({ bids, asks, mark, spread });
          }, WS_FLUSH_MS);
        }
      },
    );
    return () => {
      alive = false;
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      unsub();
    };
  }, [coin]);

  return ob;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dual history (BTC + ETH)
// ═══════════════════════════════════════════════════════════════════════════════

export function useDualHistory() {
  const [btc, setBtc]         = useState<HistoryData | null>(null);
  const [eth, setEth]         = useState<HistoryData | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const gotBtcRef = useRef(false);
  const gotEthRef = useRef(false);

  useEffect(() => {
    let active = true;
    setTimedOut(false);
    const timeout = setTimeout(() => { if (active && (!gotBtcRef.current || !gotEthRef.current)) setTimedOut(true); }, 20_000);
    const u1 = subscribeData<HistoryData>('history-BTC', () => fetchDeribitHistory('BTC'), HIST_TTL, d => { if (active) { gotBtcRef.current = true; setBtc(d); setTimedOut(false); } });
    const u2 = subscribeData<HistoryData>('history-ETH', () => fetchDeribitHistory('ETH'), HIST_TTL, d => { if (active) { gotEthRef.current = true; setEth(d); setTimedOut(false); } });
    return () => { active = false; clearTimeout(timeout); u1(); u2(); };
  }, []);

  return { btc, eth, timedOut };
}
