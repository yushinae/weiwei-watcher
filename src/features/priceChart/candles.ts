// 价格 K 线数据层 —— 复用既有 Deribit WS rpc + 共享轮询基础设施。
// 1) useCandles：通过 public/get_tradingview_chart_data 拉取 OHLC（与 deribit.ts 同一通道，无 CORS）。
// 2) computeChainLevels：从已解析的期权链派生 Call 墙 / Put 墙 / 最大痛点 / ±1σ 预期波动，
//    供 K 线图叠加。算法与 dashboardWidgets 的 GEXKeyLevels / analysis.computeMaxPain 保持一致。

import { useEffect, useState } from 'react';
import type { Coin } from '../monitor/types';
import { computeMaxPain } from '../../registry/monitorWidgetsBase';
import type { DeribitData, ExpiryGroup } from '../../registry/monitorWidgetsBase';

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

// 自带轮询（不复用 registry 的 subscribeData）—— 后者会被 App 的 pauseMonitorPolling()
// 在非 /monitor 路由全局暂停，价格图独立于监控页生命周期，必须自管轮询。
// 仍按 document.hidden 暂停以省电；底层 WS rpc 走常驻的 DERIBIT_WS 单例。
export function useCandles(coin: Coin, res: Resolution) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    const run = async () => {
      if (document.hidden) return;
      try {
        const d = await fetchCandles(coin, res);
        if (!alive) return;
        setCandles(d);
        setError(false);
        setLoading(false);
      } catch {
        if (!alive) return;
        setError(true);
        setLoading(false);
      }
    };

    run();
    const id = setInterval(run, POLL_MS[res]);
    const onVis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [coin, res]);

  return { candles, loading, error };
}

// ── 期权关键位 ───────────────────────────────────────────────────────────────

export interface ChainLevels {
  callWall: number | null;   // 最大 Call OI 行权价（spot 上方）
  putWall: number | null;    // 最大 Put OI 行权价（spot 下方）
  maxPain: number | null;    // 最大痛点
  emSigma: number | null;    // ±1σ 预期波动（美元）
  emExpiryLabel: string;     // EM 对应到期
  emDays: number | null;     // EM 对应到期剩余天数
}

const EMPTY_LEVELS: ChainLevels = {
  callWall: null, putWall: null, maxPain: null, emSigma: null, emExpiryLabel: '', emDays: null,
};

// expirySel === 'ALL' 时跨全部到期聚合 OI（与 GEXKeyLevels 行为一致）；
// 否则只取选定到期。EM 永远绑定单一到期（ALL 时取最接近 30D 的到期）。
export function computeChainLevels(
  opt: DeribitData | null,
  expirySel: string | 'ALL',
  spot: number,
): ChainLevels {
  if (!opt?.expiries.length || !spot) return EMPTY_LEVELS;

  const groups: ExpiryGroup[] =
    expirySel === 'ALL'
      ? opt.expiries
      : opt.expiries.filter(e => e.label === expirySel);
  if (!groups.length) return EMPTY_LEVELS;

  // 按行权价聚合 Call / Put OI
  const callOi = new Map<number, number>();
  const putOi = new Map<number, number>();
  for (const g of groups) {
    for (const c of g.calls) callOi.set(c.strike, (callOi.get(c.strike) ?? 0) + c.oi);
    for (const p of g.puts) putOi.set(p.strike, (putOi.get(p.strike) ?? 0) + p.oi);
  }

  const callWall = [...callOi.entries()]
    .filter(([k]) => k >= spot)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const putWall = [...putOi.entries()]
    .filter(([k]) => k <= spot)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const strikes = new Set<number>([...callOi.keys(), ...putOi.keys()]);
  const callsArr = [...callOi.entries()].map(([strike, oi]) => ({ strike, oi }));
  const putsArr = [...putOi.entries()].map(([strike, oi]) => ({ strike, oi }));
  const maxPain = strikes.size
    ? computeMaxPain(callsArr, putsArr, [...strikes].sort((a, b) => a - b))
    : null;

  // EM：取单一到期的 ATM IV
  const emGroup =
    expirySel === 'ALL'
      ? opt.expiries.reduce((best, e) =>
          Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best)
      : groups[0];
  let emSigma: number | null = null;
  if (emGroup && emGroup.atmIV > 0 && emGroup.daysToExp > 0) {
    emSigma = spot * (emGroup.atmIV / 100) * Math.sqrt(emGroup.daysToExp / 365);
  }

  return {
    callWall,
    putWall,
    maxPain,
    emSigma,
    emExpiryLabel: emGroup?.label ?? '',
    emDays: emGroup?.daysToExp ?? null,
  };
}
