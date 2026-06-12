// 价格 K 线数据层 —— 复用既有 Deribit WS rpc + 共享轮询基础设施。
// useCandles：REST 回填 + Binance kline WS 实时更新。
// 期权关键位计算（computeChainLevels）已上移到 registry/data/analysis.ts
// （决策页/监控页/价格图共用一套口径），此处仅 re-export 保持旧 import 路径可用。

import { useEffect, useState, useRef } from 'react';
import type { Coin } from '../monitor/types';
import { shouldRunFeedKey, subscribeRuntimePolicy } from '../../registry/data/runtimePolicy';

export { computeChainLevels } from '../../registry/data/analysis';
export type { ChainLevels } from '../../registry/data/analysis';

// ── K 线 ─────────────────────────────────────────────────────────────────────
// 价格源 = Binance（最深流动性的基准价、分辨率全、历史长），经 /binance-api 代理拉 klines。
// 期权关键位仍来自 Deribit 持仓数据（见 computeChainLevels），互不影响。

export type Resolution = '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface Candle {
  t: number; // 起始时间戳（ms）
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const RESOLUTION_LABEL: Record<Resolution, string> = { '5m': '5分', '15m': '15分', '1h': '1时', '4h': '4时', '1d': '1日', '1w': '1周' };

// 每个分辨率取多少根（Binance limit ≤ 1000）与轮询间隔（ms）
const LIMIT: Record<Resolution, number> = { '5m': 1000, '15m': 1000, '1h': 1000, '4h': 1000, '1d': 1000, '1w': 500 };
export { LIMIT };
const POLL_MS: Record<Resolution, number> = { '5m': 10_000, '15m': 20_000, '1h': 30_000, '4h': 60_000, '1d': 300_000, '1w': 600_000 };

export const COIN_SYMBOL: Record<Coin, string> = { BTC: 'BTCUSDT', ETH: 'ETHUSDT' };

// Binance kline 行：[openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [number, string, string, string, string, string, ...unknown[]];

export async function fetchCandles(coin: Coin, res: Resolution): Promise<Candle[]> {
  const url = `/binance-api/api/v3/klines?symbol=${COIN_SYMBOL[coin]}&interval=${res}&limit=${LIMIT[res]}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`binance klines ${r.status}`);
  const rows = (await r.json()) as BinanceKline[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c));
}

// 加载指定时间戳之前的 K 线（用于懒加载 / 跳转）
export async function fetchCandlesBefore(coin: Coin, res: Resolution, beforeTimestamp: number): Promise<Candle[]> {
  const url = `/binance-api/api/v3/klines?symbol=${COIN_SYMBOL[coin]}&interval=${res}&limit=${LIMIT[res]}&endTime=${beforeTimestamp}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`binance klines ${r.status}`);
  const rows = (await r.json()) as BinanceKline[];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
    .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c));
}

// WS-first：REST 回填一次历史，之后订阅 Binance kline WS 实时更新「形成中」的那根蜡烛。
// 价格图独立于监控页生命周期，自管连接；按 runtime policy 可见时实时、不可见时省电。
// 端点用公开数据流 data-stream.binance.vision（无 key、不受交易 API 地域限制，浏览器直连，
// WS 不受 CORS 限制）。Resolution 字符串与 Binance interval 一致，可直接拼 @kline_{res}。
// 兜底：仅在 WS 未连接时按 POLL_MS 慢轮询，保证 WS 被网络挡掉时图表也不会僵死。
export function useCandles(coin: Coin, res: Resolution) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const ref = useRef<Candle[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    ref.current = [];

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let backoff = 1_000;
    let wsConnected = false;
    let backfilled = false; // 初次回填失败 + WS 正常时，poll 兜底继续重试，否则图上只剩 WS 那一根
    const feedKey = `candles-${coin}-${res}`;
    const shouldRun = () => shouldRunFeedKey(feedKey, { mode: 'visible-live' });

    const commit = (next: Candle[]) => { ref.current = next; if (alive) setCandles(next); };

    // REST 回填（初次 + 重连/回到前台时重对齐）
    const backfill = async () => {
      try {
        const d = await fetchCandles(coin, res);
        if (!alive) return;
        backfilled = true;
        if (wsConnected) stopPoll();
        commit(d);
        setError(false);
        setLoading(false);
      } catch {
        if (alive && ref.current.length === 0) { setError(true); setLoading(false); }
      }
    };

    // 把一根 WS kline 并入序列：同起始时间→替换最后一根（形成中），更新→追加并裁剪窗口
    const mergeKline = (k: Candle) => {
      const arr = ref.current;
      if (!arr.length) { commit([k]); return; }
      const last = arr[arr.length - 1];
      if (k.t === last.t) { const next = arr.slice(); next[next.length - 1] = k; commit(next); }
      else if (k.t > last.t) { commit([...arr, k].slice(-LIMIT[res])); }
      // 更早的帧忽略
    };

    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    const startPoll = () => {
      if (pollTimer || !shouldRun()) return;
      pollTimer = setInterval(() => { if ((!wsConnected || !backfilled) && shouldRun()) backfill(); }, POLL_MS[res]);
    };

    const scheduleReconnect = () => {
      if (!alive || reconnectTimer || !shouldRun()) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, 30_000);
        connectWS();
      }, backoff);
    };

    const connectWS = () => {
      if (!alive || !shouldRun()) return;
      const stream = `${COIN_SYMBOL[coin].toLowerCase()}@kline_${res}`;
      let sock: WebSocket;
      try { sock = new WebSocket(`wss://data-stream.binance.vision/ws/${stream}`); }
      catch { startPoll(); scheduleReconnect(); return; }
      ws = sock;
      sock.onopen = () => { wsConnected = true; backoff = 1_000; if (backfilled) stopPoll(); };
      sock.onmessage = (e: MessageEvent) => {
        try {
          const k = (JSON.parse(e.data as string) as { k?: { t: number; o: string; h: string; l: string; c: string; v: string } }).k;
          if (!k) return;
          const c: Candle = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v };
          if (Number.isFinite(c.o) && Number.isFinite(c.c)) mergeKline(c);
        } catch { /* ignore malformed frame */ }
      };
      sock.onclose = () => {
        wsConnected = false;
        if (ws === sock) ws = null;
        startPoll();          // WS 断开期间慢轮询兜底
        scheduleReconnect();
      };
      sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
    };

    const applyPolicy = () => {
      if (!shouldRun()) {
        if (ws) { ws.onclose = null; try { ws.close(); } catch { /* noop */ } ws = null; }
        wsConnected = false;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        stopPoll();
      } else {
        backfill();           // 回到前台先重对齐历史
        connectWS();
        startPoll();
      }
    };

    backfill();
    connectWS();
    startPoll(); // 兜底从一开始就挂着：初次回填失败时按 POLL_MS 重试，成功且 WS 在线后自停
    const unsubscribePolicy = subscribeRuntimePolicy(applyPolicy);

    return () => {
      alive = false;
      unsubscribePolicy();
      if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch { /* noop */ } ws = null; }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPoll();
    };
  }, [coin, res]);

  return { candles, loading, error };
}
