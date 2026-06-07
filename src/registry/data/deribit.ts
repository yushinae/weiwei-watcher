import { useState, useEffect } from 'react';
import { bsDelta } from '../lib/bs-math';
import type { Coin } from '../../features/monitor/types';
import { subscribeData } from './poller';

// ═══════════════════════════════════════════════════════════════════════════════
// Deribit data types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ParsedOption {
  strike: number;
  type: 'C' | 'P';
  daysToExp: number;
  T: number;
  iv: number;
  spot: number;
  delta: number;
  oi: number;
  volume: number;
  instrument: string; // Deribit instrument_name, e.g. "BTC-27JUN25-100000-C" (for WS ticker subscribe)
  mark: number;       // USD mark (book_summary mark_price × underlying); real, not BS-derived
  bid: number | null; // USD bid (null when no quote)
  ask: number | null; // USD ask (null when no quote)
}

export interface ExpiryGroup {
  label: string;
  daysToExp: number;
  calls: ParsedOption[];
  puts: ParsedOption[];
  atmIV: number;
  rr25: number;
  bf25: number;
  rr10: number;
  bf10: number;
}

export interface DeribitData {
  spot: number;
  dvol30: number;
  pcr: number;
  expiries: ExpiryGroup[];
  callVol24h: number;
  putVol24h: number;
  totalOptOI: number;
  totalOptVol24hUSD: number;
  fetchedAt: number;
}

export interface VolConeSlice {
  tenors: number[];
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export interface HistoryData {
  vrp: { iv: number; rv: number }[];
  ivr: number[];
  ivRankCurrent: number;
  dvolChange24h: number;
  volCone: VolConeSlice;
  rvByTenor: number[];
  dvolSeries: number[];
  rv30Series: number[];
  priceCloseSeries: number[];
  fetchedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parsing helpers
// ═══════════════════════════════════════════════════════════════════════════════

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseDeribitExpiry(s: string): Date | null {
  // 日期段可能是 1~2 位日（如 6JUN26 / 27JUN26）——必须用正则，slice(2,5) 对单位数日会错位丢掉当天/末日期权
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(s);
  if (!m) return null;
  const day = parseInt(m[1]);
  const mon = MONTH_MAP[m[2]];
  const yr = 2000 + parseInt(m[3]);
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return new Date(Date.UTC(yr, mon, day, 8, 0, 0));
}

export function closestDeltaIV(opts: ParsedOption[], targetAbsDelta: number): number {
  if (!opts.length) return 0;
  return opts.reduce((best, o) =>
    Math.abs(Math.abs(o.delta) - targetAbsDelta) < Math.abs(Math.abs(best.delta) - targetAbsDelta) ? o : best
  ).iv;
}

// minGroupDays / perOptFloor 让监控页与期权链共用解析但各取所需：
//   监控页 = (0, 0.02)：放开 0DTE/末日，只挡掉 ~30 分钟内即将到期的；
//   期权链 = (0, 0.02)：放开末日/临期期权，只挡掉 ~30 分钟内即将到期的。
export function processDeribitResponse(results: any[], minGroupDays = 0, perOptFloor = 0.02): DeribitData {
  const now = Date.now();
  const parsed: ParsedOption[] = [];

  for (const item of results) {
    if (!item.instrument_name || !item.mark_iv || item.mark_iv <= 0) continue;
    const parts = (item.instrument_name as string).split('-');
    if (parts.length < 4) continue;
    const expiry = parseDeribitExpiry(parts[1]);
    if (!expiry) continue;
    const daysToExp = (expiry.getTime() - now) / 86_400_000;
    if (daysToExp < perOptFloor || daysToExp > 200) continue;
    const strike = parseInt(parts[2]);
    const type = parts[3] as 'C' | 'P';
    if (isNaN(strike) || (type !== 'C' && type !== 'P')) continue;
    const spot: number = item.underlying_price ?? item.index_price ?? 0;
    if (spot <= 0) continue;
    const T = daysToExp / 365;
    const delta = bsDelta(spot, strike, T, item.mark_iv, type);
    const deltaFloor = daysToExp < 2 ? 0.001 : 0.04;
    if (Math.abs(delta) < deltaFloor || Math.abs(delta) > 0.96) continue;

    // Real USD prices — Deribit inverse options quote in coin, so ×underlying (forward).
    const toUsd = (c: unknown) => { const n = c as number; return Number.isFinite(n) && n > 0 ? n * spot : null; };

    parsed.push({
      strike, type, daysToExp, T,
      iv: item.mark_iv as number,
      spot,
      delta,
      oi: (item.open_interest ?? 0) as number,
      volume: (item.volume ?? 0) as number,
      instrument: item.instrument_name as string,
      mark: toUsd(item.mark_price) ?? 0,
      bid: toUsd(item.bid_price),
      ask: toUsd(item.ask_price),
    });
  }

  if (!parsed.length) throw new Error('no valid options');

  const spot = parsed[0].spot;

  const totalPutOI = parsed.filter(o => o.type === 'P').reduce((s, o) => s + o.oi, 0);
  const totalCallOI = parsed.filter(o => o.type === 'C').reduce((s, o) => s + o.oi, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1.0;
  const callVol24h = parsed.filter(o => o.type === 'C').reduce((s, o) => s + o.volume, 0);
  const putVol24h  = parsed.filter(o => o.type === 'P').reduce((s, o) => s + o.volume, 0);

  const groups = new Map<number, ParsedOption[]>();
  for (const opt of parsed) {
    const key = Math.round(opt.daysToExp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  const expiries: ExpiryGroup[] = [];
  for (const [days, opts] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (days < minGroupDays) continue;
    const calls = opts.filter(o => o.type === 'C').sort((a, b) => a.delta - b.delta);
    const puts = opts.filter(o => o.type === 'P').sort((a, b) => b.delta - a.delta);

    const atmCall = calls.reduce(
      (best, o) => Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best,
      calls[0]
    );
    const atmIV = atmCall?.iv ?? 50;

    const call25IV = closestDeltaIV(calls, 0.25);
    const put25IV  = closestDeltaIV(puts,  0.25);
    const call10IV = closestDeltaIV(calls, 0.10);
    const put10IV  = closestDeltaIV(puts,  0.10);

    expiries.push({
      label: `${days}D`,
      daysToExp: days,
      calls,
      puts,
      atmIV,
      rr25: call25IV - put25IV,
      bf25: (call25IV + put25IV) / 2 - atmIV,
      rr10: call10IV - put10IV,
      bf10: (call10IV + put10IV) / 2 - atmIV,
    });
  }

  const dvol30Exp = expiries.reduce(
    (best, e) => Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best,
    expiries[0]
  );
  const dvol30 = dvol30Exp?.atmIV ?? 50;

  return { spot, dvol30, pcr, expiries, callVol24h, putVol24h, totalOptOI: 0, totalOptVol24hUSD: 0, fetchedAt: now };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════════

export const DERIBIT_CACHE = new Map<string, { data: DeribitData; ts: number; v: number }>();
export const CACHE_TTL = 300_000;
const CACHE_VERSION = 3; // bump to invalidate stale cache after filter changes
export const HIST_CACHE = new Map<string, { data: HistoryData; ts: number }>();
export const HIST_TTL = 900_000;

// ═══════════════════════════════════════════════════════════════════════════════
// Rolling RV / percentile helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function rollingRV(logRets: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = window - 1; i < logRets.length; i++) {
    const w = logRets.slice(i - window + 1, i + 1);
    const mean = w.reduce((s, r) => s + r, 0) / w.length;
    const v = w.reduce((s, r) => s + (r - mean) ** 2, 0) / w.length;
    out.push(Math.sqrt(v * 252) * 100);
  }
  return out;
}

export function percentileAt(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * ((sorted[hi] ?? sorted[lo]) - sorted[lo]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fetch + hooks
// ═══════════════════════════════════════════════════════════════════════════════

import { DERIBIT_WS } from './ws';

export async function fetchDeribitOptions(currency: 'BTC' | 'ETH'): Promise<DeribitData> {
  const cached = DERIBIT_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL && cached.v === CACHE_VERSION) return cached.data;

  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message ?? 'API error');
  const rawResults: any[] = json.result ?? [];

  const totalOptOI        = rawResults.reduce((s, b) => s + (b.open_interest ?? 0), 0);
  const totalOptVol24hUSD = rawResults.reduce((s, b) => s + (b.volume_usd      ?? 0), 0);

  const data = processDeribitResponse(rawResults);
  data.totalOptOI        = totalOptOI;
  data.totalOptVol24hUSD = totalOptVol24hUSD;
  DERIBIT_CACHE.set(currency, { data, ts: Date.now(), v: CACHE_VERSION });
  return data;
}

export function useDeribitOptions(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => {
        if (!active) return;
        setLoading(false);
        setData(prev => (prev && prev.fetchedAt === d.fetchedAt ? prev : d));
      },
    );
    return () => { active = false; unsub(); };
  }, [coin]);

  return { data, loading };
}

// ── 期权链专用：含末日/临期期权（独立缓存，不影响监控页的 GEX/速读）──
const DERIBIT_CHAIN_CACHE = new Map<string, { data: DeribitData; ts: number }>();

export async function fetchDeribitChainOptions(currency: 'BTC' | 'ETH'): Promise<DeribitData> {
  const cached = DERIBIT_CHAIN_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message ?? 'API error');
  const rawResults: any[] = json.result ?? [];

  const totalOptOI        = rawResults.reduce((s, b) => s + (b.open_interest ?? 0), 0);
  const totalOptVol24hUSD = rawResults.reduce((s, b) => s + (b.volume_usd      ?? 0), 0);

  const data = processDeribitResponse(rawResults, 0, 0.02); // 放开 0DTE/末日
  data.totalOptOI        = totalOptOI;
  data.totalOptVol24hUSD = totalOptVol24hUSD;
  DERIBIT_CHAIN_CACHE.set(currency, { data, ts: Date.now() });
  return data;
}

export function useDeribitChainOptions(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-chain-${coin}`,
      () => fetchDeribitChainOptions(coin),
      CACHE_TTL,
      d => {
        if (!active) return;
        setLoading(false);
        setData(prev => (prev && prev.fetchedAt === d.fetchedAt ? prev : d));
      },
    );
    return () => { active = false; unsub(); };
  }, [coin]);

  return { data, loading };
}

export async function fetchDeribitHistory(currency: 'BTC' | 'ETH'): Promise<HistoryData> {
  const cached = HIST_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < HIST_TTL) return cached.data;

  const now = Date.now();
  const d750ago = now - 750 * 86_400_000;
  const d365ago = now - 365 * 86_400_000;
  const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';
  const perpName = currency === 'BTC' ? 'BTC-PERPETUAL' : 'ETH-PERPETUAL';
  void indexName;
  const [priceResult, dvolResp] = await Promise.all([
    DERIBIT_WS.rpc<{ close?: number[] }>('public/get_tradingview_chart_data', {
      instrument_name: perpName,
      start_timestamp: d750ago,
      end_timestamp: now,
      resolution: '1D',
    }).catch(() => ({ close: [] as number[] })),
    fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&start_timestamp=${d365ago}&end_timestamp=${now}&resolution=86400`),
  ]);
  const dvolJson = await dvolResp.json();

  const prices: number[]    = (priceResult?.close ?? []) as number[];
  const dvolCloses: number[] = ((dvolJson.result?.data  ?? []) as number[][]).map(d => d[4]);

  if (prices.length < 32) throw new Error('price history too short');
  if (dvolCloses.length < 2) throw new Error('DVOL history too short');

  const logRets = prices.slice(1).map((p, i) => Math.log(p / prices[i]));

  const rv30All = rollingRV(logRets, 30);
  const pairLen = Math.min(30, rv30All.length, dvolCloses.length);
  const vrp: { iv: number; rv: number }[] = Array.from({ length: pairLen }, (_, i) => ({
    iv: dvolCloses[dvolCloses.length - pairLen + i],
    rv: rv30All[rv30All.length - pairLen + i],
  }));

  const dvolMin = Math.min(...dvolCloses);
  const dvolMax = Math.max(...dvolCloses);
  const ivr = dvolCloses.map(v =>
    dvolMax > dvolMin ? ((v - dvolMin) / (dvolMax - dvolMin)) * 100 : 50
  );
  const ivRankCurrent = ivr[ivr.length - 1] ?? 50;

  const dvolChange24h = dvolCloses.length >= 2
    ? dvolCloses[dvolCloses.length - 1] - dvolCloses[dvolCloses.length - 2]
    : 0;

  const CONE_TENORS = [7, 14, 30, 60, 90, 180] as const;
  const coneP10: number[] = [], coneP25: number[] = [], coneP50: number[] = [];
  const coneP75: number[] = [], coneP90: number[] = [];

  for (const t of CONE_TENORS) {
    const series = rollingRV(logRets, t);
    if (!series.length) {
      [coneP10, coneP25, coneP50, coneP75, coneP90].forEach(a => a.push(0));
      continue;
    }
    const sorted = [...series].sort((a, b) => a - b);
    coneP10.push(percentileAt(sorted, 10));
    coneP25.push(percentileAt(sorted, 25));
    coneP50.push(percentileAt(sorted, 50));
    coneP75.push(percentileAt(sorted, 75));
    coneP90.push(percentileAt(sorted, 90));
  }

  const volCone: VolConeSlice = {
    tenors: [...CONE_TENORS],
    p10: coneP10, p25: coneP25, p50: coneP50, p75: coneP75, p90: coneP90,
  };

  const RV_TENORS = [7, 14, 30, 60, 90, 180, 365] as const;
  const rvByTenor: number[] = RV_TENORS.map(t => {
    const s = rollingRV(logRets, t);
    return s[s.length - 1] ?? 0;
  });

  const SERIES_LEN = 90;
  const dvolSeries = dvolCloses.slice(-SERIES_LEN);
  const rv30Series = rv30All.slice(-SERIES_LEN);
  const priceCloseSeries = prices.slice(-SERIES_LEN);

  const data: HistoryData = { vrp, ivr, ivRankCurrent, dvolChange24h, volCone, rvByTenor, dvolSeries, rv30Series, priceCloseSeries, fetchedAt: now };
  HIST_CACHE.set(currency, { data, ts: now });
  return data;
}

export function useDeribitHistory(coin: Coin) {
  const [data, setData]       = useState<HistoryData | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let active = true;
    setTimedOut(false);
    let arrived = false;
    const timeout = setTimeout(() => { if (active && !arrived) setTimedOut(true); }, 20_000);
    const unsub = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => {
        if (!active) return;
        arrived = true;
        setTimedOut(false);
        setData(prev => (prev && prev.fetchedAt === d.fetchedAt ? prev : d));
      },
    );
    return () => { active = false; clearTimeout(timeout); unsub(); };
  }, [coin]);

  return { data, timedOut };
}
