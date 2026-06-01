import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import {
  VOL_CONE,
  VRP_HIST, IVR_HIST,
  VOL,
} from '../features/monitor/data/mock';

// Black-Scholes + AR(1) 数学库 —— 复用共享实现（原本在此重复定义了一整套）。
import {
  normCDF,
  bsDelta, bsGamma, bsVanna, bsCharm, bsVega, bsTheta, bsCall, bsPut,
  fitAR1, forecastAR1, heatColor,
} from './lib/bs-math';
// WebSocket 管理器类 —— 复用 data/ws.ts 的实现（监控页自持实例见下方）。
import { DeribitWS } from './data/ws';

// ═══════════════════════════════════════════════════════════════════════════════
// Deribit data types
// ═══════════════════════════════════════════════════════════════════════════════

interface ParsedOption {
  strike: number;
  type: 'C' | 'P';
  daysToExp: number;
  T: number;
  iv: number;
  spot: number;
  delta: number;
  oi: number;
  volume: number;
}

interface ExpiryGroup {
  label: string;       // e.g. "7D", "28D"
  daysToExp: number;
  calls: ParsedOption[];
  puts: ParsedOption[];
  atmIV: number;
  rr25: number;
  bf25: number;
  rr10: number;
  bf10: number;
}

interface DeribitData {
  spot: number;
  dvol30: number;
  pcr: number;
  expiries: ExpiryGroup[];
  callVol24h: number;
  putVol24h: number;
  totalOptOI: number;        // sum of open_interest across ALL options (contracts, not filtered)
  totalOptVol24hUSD: number; // sum of volume_usd across ALL options (raw USD)
  fetchedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Deribit parsing + fetch + cache
// ═══════════════════════════════════════════════════════════════════════════════

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseDeribitExpiry(s: string): Date | null {
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP[s.slice(2, 5)];
  const yr = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return new Date(Date.UTC(yr, mon, day, 8, 0, 0));
}

function closestDeltaIV(opts: ParsedOption[], targetAbsDelta: number): number {
  if (!opts.length) return 0;
  return opts.reduce((best, o) =>
    Math.abs(Math.abs(o.delta) - targetAbsDelta) < Math.abs(Math.abs(best.delta) - targetAbsDelta) ? o : best
  ).iv;
}

function processDeribitResponse(results: any[]): DeribitData {
  const now = Date.now();
  const parsed: ParsedOption[] = [];

  for (const item of results) {
    if (!item.instrument_name || !item.mark_iv || item.mark_iv <= 0) continue;
    const parts = (item.instrument_name as string).split('-');
    if (parts.length < 4) continue;
    const expiry = parseDeribitExpiry(parts[1]);
    if (!expiry) continue;
    const daysToExp = (expiry.getTime() - now) / 86_400_000;
    if (daysToExp < 0.5 || daysToExp > 200) continue;
    const strike = parseInt(parts[2]);
    const type = parts[3] as 'C' | 'P';
    if (isNaN(strike) || (type !== 'C' && type !== 'P')) continue;
    const spot: number = item.underlying_price ?? item.index_price ?? 0;
    if (spot <= 0) continue;
    const T = daysToExp / 365;
    const delta = bsDelta(spot, strike, T, item.mark_iv, type);
    if (Math.abs(delta) < 0.04 || Math.abs(delta) > 0.96) continue;

    parsed.push({
      strike, type, daysToExp, T,
      iv: item.mark_iv as number,
      spot,
      delta,
      oi: (item.open_interest ?? 0) as number,
      volume: (item.volume ?? 0) as number,
    });
  }

  if (!parsed.length) throw new Error('no valid options');

  const spot = parsed[0].spot;

  const totalPutOI = parsed.filter(o => o.type === 'P').reduce((s, o) => s + o.oi, 0);
  const totalCallOI = parsed.filter(o => o.type === 'C').reduce((s, o) => s + o.oi, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1.0;
  const callVol24h = parsed.filter(o => o.type === 'C').reduce((s, o) => s + o.volume, 0);
  const putVol24h  = parsed.filter(o => o.type === 'P').reduce((s, o) => s + o.volume, 0);

  // Group by day-rounded expiry
  const groups = new Map<number, ParsedOption[]>();
  for (const opt of parsed) {
    const key = Math.round(opt.daysToExp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  const expiries: ExpiryGroup[] = [];
  for (const [days, opts] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (days < 2) continue;
    const calls = opts.filter(o => o.type === 'C').sort((a, b) => a.delta - b.delta);
    const puts = opts.filter(o => o.type === 'P').sort((a, b) => b.delta - a.delta);

    // ATM: call with strike closest to spot
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

  // DVOL proxy: ATM IV of expiry closest to 30D
  const dvol30Exp = expiries.reduce(
    (best, e) => Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best,
    expiries[0]
  );
  const dvol30 = dvol30Exp?.atmIV ?? 50;

  return { spot, dvol30, pcr, expiries, callVol24h, putVol24h, totalOptOI: 0, totalOptVol24hUSD: 0, fetchedAt: now };
}

const DERIBIT_CACHE = new Map<string, { data: DeribitData; ts: number }>();
const CACHE_TTL = 300_000; // 300s — spot/DVOL/trades now come via WS; options chain REST can be slow

// ═══════════════════════════════════════════════════════════════════════════════
// Shared polling scheduler
// One setInterval per data-key, shared across every widget that needs the same
// data. Pauses automatically when the window/tab is hidden (Page Visibility API).
// ═══════════════════════════════════════════════════════════════════════════════

type DataSub<T> = (data: T) => void;

interface PollerEntry {
  intervalMs: number;
  subscribers: Set<DataSub<unknown>>;
  lastData: unknown;
  fetcher: () => Promise<unknown>;
  timerId: ReturnType<typeof setInterval> | null;
}

const POLLERS = new Map<string, PollerEntry>();
let _isHidden    = false;
let _routeActive = false;                          // 监控页当前是否为活动路由（由 App 控制）
let _focusLostAt: number | null = null;            // non-null when window has lost focus
const UNFOCUS_PAUSE_MS = 90_000;                   // pause all polls 90s after losing focus

/** Returns true whenever polls should be skipped (tab hidden OR idle too long) */
function _shouldSkip(): boolean {
  if (_isHidden) return true;
  if (_focusLostAt !== null && Date.now() - _focusLostAt > UNFOCUS_PAUSE_MS) return true;
  return false;
}

async function _pollOnce(key: string): Promise<void> {
  if (_shouldSkip()) return;
  const e = POLLERS.get(key);
  if (!e || e.subscribers.size === 0) return;
  try {
    const d = await e.fetcher();
    if (_shouldSkip()) return; // drop result if we went idle during the await
    e.lastData = d;
    e.subscribers.forEach(fn => fn(d));
  } catch {}
}

function _startMonitorTimers(): void {
  POLLERS.forEach((e, key) => {
    if (e.subscribers.size > 0 && e.timerId == null) {
      _pollOnce(key); // refresh stale data right away
      e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
    }
  });
  DERIBIT_WS.resume();
}

function _stopMonitorTimers(): void {
  POLLERS.forEach(e => {
    if (e.timerId != null) { clearInterval(e.timerId); e.timerId = null; }
  });
  DERIBIT_WS.pause();
}

// App 切到监控页时调用：标记路由活动，仅当标签页可见时才真正启动。
export function resumeMonitorPolling(): void {
  _routeActive = true;
  if (typeof document !== 'undefined' && document.hidden) return; // 等 visibilitychange 再启动
  _isHidden = false;
  _startMonitorTimers();
}

// App 切走监控页时调用：标记路由非活动并暂停一切。
export function pauseMonitorPolling(): void {
  _routeActive = false;
  _isHidden = true;
  _stopMonitorTimers();
}

if (typeof document !== 'undefined') {
  // 标签页隐藏/显示（切换浏览器标签或最小化窗口）。
  // 隐藏：暂停但保留 _routeActive，以便恢复时能继续。
  // 显示：仅当监控页仍是活动路由时才恢复 —— 否则会在其他页面错误重连监控 WS。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _isHidden = true;
      _stopMonitorTimers();
    } else if (_routeActive) {
      _isHidden = false;
      _startMonitorTimers();
    }
  });
}

if (typeof window !== 'undefined') {
  // Window loses focus → user switched to another app.
  // visibilitychange doesn't fire in this case; we use window blur/focus instead.
  // A 90s grace period avoids pausing on momentary focus losses (address bar, DevTools).
  window.addEventListener('blur', () => {
    if (!document.hasFocus()) _focusLostAt = _focusLostAt ?? Date.now();
  });
  window.addEventListener('focus', () => {
    if (_focusLostAt === null) return;
    const wasLongAway = Date.now() - _focusLostAt > UNFOCUS_PAUSE_MS;
    _focusLostAt = null;
    if (wasLongAway && _routeActive && !_isHidden) {
      POLLERS.forEach((_, key) => _pollOnce(key));
      DERIBIT_WS.resume(); // reconnect WS and re-deliver fresh data
    }
  });
}

/**
 * Like setInterval but automatically pauses when the page is hidden OR the
 * window has been unfocused for more than UNFOCUS_PAUSE_MS. Returns cleanup fn.
 */
function setVisibleInterval(cb: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const tick = () => { if (!_shouldSkip()) cb(); };
  const start = () => { if (id == null) id = setInterval(tick, ms); };
  const stop  = () => { if (id != null) { clearInterval(id); id = null; } };
  const onVis = () => document.hidden ? stop() : start();
  if (!document.hidden) start();
  document.addEventListener('visibilitychange', onVis);
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}

function subscribeData<T>(
  key: string,
  fetcher: () => Promise<T>,
  intervalMs: number,
  subscriber: DataSub<T>,
): () => void {
  let e = POLLERS.get(key);
  if (!e) {
    e = {
      intervalMs,
      subscribers: new Set(),
      lastData: undefined,
      fetcher: fetcher as () => Promise<unknown>,
      timerId: null,
    };
    POLLERS.set(key, e);
  }
  const entry = e;
  entry.subscribers.add(subscriber as DataSub<unknown>);

  // If we have cached data, deliver it immediately so the widget renders at once
  if (entry.lastData !== undefined) subscriber(entry.lastData as T);

  // Start the shared interval if nothing is running
  if (entry.timerId == null && !_isHidden) {
    if (entry.lastData === undefined) _pollOnce(key); // first-ever fetch
    entry.timerId = setInterval(() => _pollOnce(key), intervalMs);
  }

  // Return an unsubscribe function
  return () => {
    entry.subscribers.delete(subscriber as DataSub<unknown>);
    // Stop the interval only when the last subscriber leaves
    if (entry.subscribers.size === 0 && entry.timerId != null) {
      clearInterval(entry.timerId);
      entry.timerId = null;
      // lastData is kept so the next subscriber of the same key
      // can skip the loading state on remount (e.g. tab switch)
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DeribitWS — 复用 data/ws.ts 的实现（原本在此重复了一份较旧的简化版）。
// 监控页仍持有自己的实例 DERIBIT_WS，以便 keep-alive 时能独立暂停/恢复连接，
// 不影响顶栏行情与决策页所用的另一实例。
// ═══════════════════════════════════════════════════════════════════════════════

const DERIBIT_WS = new DeribitWS();
// 不在模块加载时急连：hover 预加载监控页 chunk 不应在仍处于其他页面时就打开 WS。
// 实际连接由 resumeMonitorPolling()（App 切到 /monitor 时调用）负责。

/** Max UI update rate for WS-driven hooks: 2 Hz. Keeps React reconciliation cheap. */
const WS_FLUSH_MS = 500;

async function fetchDeribitOptions(currency: 'BTC' | 'ETH'): Promise<DeribitData> {
  const cached = DERIBIT_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message ?? 'API error');
  const rawResults: any[] = json.result ?? [];

  // Compute totals from raw results BEFORE filtering (used by SpotTickerWidget)
  const totalOptOI        = rawResults.reduce((s, b) => s + (b.open_interest ?? 0), 0);
  const totalOptVol24hUSD = rawResults.reduce((s, b) => s + (b.volume_usd      ?? 0), 0);

  const data = processDeribitResponse(rawResults);
  data.totalOptOI        = totalOptOI;
  data.totalOptVol24hUSD = totalOptVol24hUSD;
  DERIBIT_CACHE.set(currency, { data, ts: Date.now() });
  return data;
}

function useDeribitOptions(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);
  const lastFetchedRef = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => {
        if (!active) return;
        if (d.fetchedAt === lastFetchedRef.current && data !== null) return;
        lastFetchedRef.current = d.fetchedAt;
        setData(d);
        setLoading(false);
      },
    );
    return () => { active = false; unsub(); };
  }, [coin]);

  return { data, loading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Deribit history (DVOL + price index → rolling RV + IV Rank)
// ═══════════════════════════════════════════════════════════════════════════════

interface VolConeSlice {
  tenors: number[];   // [7,14,30,60,90,180]
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

interface HistoryData {
  vrp: { iv: number; rv: number }[];   // 30 daily points
  ivr: number[];                        // up to 365 daily IV-rank values (0–100)
  ivRankCurrent: number;               // 52-week percentile
  dvolChange24h: number;               // today vs yesterday DVOL
  volCone: VolConeSlice;               // RV percentile bands per tenor
  rvByTenor: number[];                 // current rolling RV at [7,14,30,60,90,180,365]D
  dvolSeries: number[];                // last 90 daily DVOL closing values
  rv30Series: number[];                // last 90 daily 30D-RV values (aligned with dvolSeries)
  priceCloseSeries: number[];          // last 90 daily spot close prices (for correlation etc.)
  fetchedAt: number;
}

const HIST_CACHE = new Map<string, { data: HistoryData; ts: number }>();
const HIST_TTL = 900_000; // 15 min – history moves slowly

// ── Rolling RV (annualised %) ────────────────────────────────────────────────
function rollingRV(logRets: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = window - 1; i < logRets.length; i++) {
    const w = logRets.slice(i - window + 1, i + 1);
    const mean = w.reduce((s, r) => s + r, 0) / w.length;
    const v = w.reduce((s, r) => s + (r - mean) ** 2, 0) / w.length;
    out.push(Math.sqrt(v * 252) * 100);
  }
  return out;
}

function percentileAt(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * ((sorted[hi] ?? sorted[lo]) - sorted[lo]);
}

async function fetchDeribitHistory(currency: 'BTC' | 'ETH'): Promise<HistoryData> {
  const cached = HIST_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < HIST_TTL) return cached.data;

  const now = Date.now();
  // 750 days price: enough for 365D rolling-RV window + meaningful cone statistics
  // 365 days DVOL: proper 52-week IV Rank
  const d750ago = now - 750 * 86_400_000;
  const d365ago = now - 365 * 86_400_000;
  const indexName = currency === 'BTC' ? 'btc_usd' : 'eth_usd';

  const [priceResp, dvolResp] = await Promise.all([
    fetch(`https://www.deribit.com/api/v2/public/get_index_price_history?index_name=${indexName}&start_timestamp=${d750ago}&end_timestamp=${now}&resolution=86400`),
    fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${currency}&start_timestamp=${d365ago}&end_timestamp=${now}&resolution=86400`),
  ]);
  const [priceJson, dvolJson] = await Promise.all([priceResp.json(), dvolResp.json()]);

  const prices: number[]    = ((priceJson.result?.data ?? []) as [number, number][]).map(d => d[1]);
  const dvolCloses: number[] = ((dvolJson.result?.data  ?? []) as number[][]).map(d => d[4]);

  if (prices.length < 32) throw new Error('price history too short');
  if (dvolCloses.length < 2) throw new Error('DVOL history too short');

  const logRets = prices.slice(1).map((p, i) => Math.log(p / prices[i]));

  // ── VRP: 30D rolling RV, last 30 points paired with DVOL ─────────────────
  const rv30All = rollingRV(logRets, 30);
  const pairLen = Math.min(30, rv30All.length, dvolCloses.length);
  const vrp: { iv: number; rv: number }[] = Array.from({ length: pairLen }, (_, i) => ({
    iv: dvolCloses[dvolCloses.length - pairLen + i],
    rv: rv30All[rv30All.length - pairLen + i],
  }));

  // ── IV Rank series (90D percentile) ──────────────────────────────────────
  const dvolMin = Math.min(...dvolCloses);
  const dvolMax = Math.max(...dvolCloses);
  const ivr = dvolCloses.map(v =>
    dvolMax > dvolMin ? ((v - dvolMin) / (dvolMax - dvolMin)) * 100 : 50
  );
  const ivRankCurrent = ivr[ivr.length - 1] ?? 50;

  // ── 24h DVOL change ───────────────────────────────────────────────────────
  const dvolChange24h = dvolCloses.length >= 2
    ? dvolCloses[dvolCloses.length - 1] - dvolCloses[dvolCloses.length - 2]
    : 0;

  // ── Vol Cone: percentile bands of rolling RV at 6 tenors ─────────────────
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

  // ── Current rolling RV at [7,14,30,60,90,180,365] ────
  const RV_TENORS = [7, 14, 30, 60, 90, 180, 365] as const;
  const rvByTenor: number[] = RV_TENORS.map(t => {
    const s = rollingRV(logRets, t);
    return s[s.length - 1] ?? 0;
  });

  // ── Last 90D DVOL + aligned 30D-RV + price closes ────────────────────────
  const SERIES_LEN = 90;
  const dvolSeries = dvolCloses.slice(-SERIES_LEN);
  const rv30Series = rv30All.slice(-SERIES_LEN);
  const priceCloseSeries = prices.slice(-SERIES_LEN);

  const data: HistoryData = { vrp, ivr, ivRankCurrent, dvolChange24h, volCone, rvByTenor, dvolSeries, rv30Series, priceCloseSeries, fetchedAt: now };
  HIST_CACHE.set(currency, { data, ts: now });
  return data;
}

function useDeribitHistory(coin: Coin) {
  const [data, setData]       = useState<HistoryData | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const lastFetchedRef = useRef(0);

  useEffect(() => {
    let active = true;
    setTimedOut(false);
    // Show "load failed" hint if no data after 20 s
    const timeout = setTimeout(() => { if (active && !data) setTimedOut(true); }, 20_000);
    const unsub = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => {
        if (!active) return;
        if (d.fetchedAt === lastFetchedRef.current && data !== null) return;
        lastFetchedRef.current = d.fetchedAt;
        setTimedOut(false);
        setData(d);
      },
    );
    return () => { active = false; clearTimeout(timeout); unsub(); };
  }, [coin]);

  return { data, timedOut };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SVG helpers
// ═══════════════════════════════════════════════════════════════════════════════

function mapPts(data: number[], W: number, H: number, lo: number, hi: number, px = 0, py = 0): [number, number][] {
  const range = hi - lo || 1;
  return data.map((v, i) => [
    px + (i / Math.max(data.length - 1, 1)) * (W - 2 * px),
    (H - py) - ((v - lo) / range) * (H - 2 * py),
  ]);
}
function poly(pts: [number, number][]) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]; const [cx, cy] = pts[i];
    const dx = (cx - px) * 0.45;
    d += ` C ${(px + dx).toFixed(1)} ${py.toFixed(1)},${(cx - dx).toFixed(1)} ${cy.toFixed(1)},${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }
  return d;
}
function area(pts: [number, number][], H: number, padY = 0) {
  if (!pts.length) return '';
  const bot = H - padY;
  return `${smooth(pts)} L ${pts[pts.length - 1][0].toFixed(1)} ${bot} L ${pts[0][0].toFixed(1)} ${bot} Z`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Colors + helpers
// ═══════════════════════════════════════════════════════════════════════════════

const GRID   = 'rgba(255,255,255,0.07)';
const TXT    = 'rgba(255,255,255,0.32)';
const BRAND  = 'rgba(37,232,137,0.92)';
const YELLOW = '#FEBC2E';
const BLUE   = '#4ea1ff';

// ── Global SVG gradient defs (render once in MonitorPage) ─────────────────────
// Chromium / Electron: cross-SVG url() references work within the same document.
export function GlobalGradDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true"
      style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none', opacity: 0 }}>
      <defs>
        {/* vertical: colour → transparent */}
        <linearGradient id="wg-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#25e889" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#25e889" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-green-strong" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#25e889" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#25e889" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF5F57" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#FF5F57" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-yellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FEBC2E" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#FEBC2E" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ea1ff" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#4ea1ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-purple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        {/* inverted (bottom → top) for short/negative fills */}
        <linearGradient id="wg-red-inv" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#FF5F57" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#FF5F57" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ivrColor(r: number) { return r <= 30 ? '#28C840' : r <= 70 ? '#FEBC2E' : '#FF5F57'; }
function ivrLabel(r: number) { return r <= 20 ? '极低' : r <= 40 ? '偏低' : r <= 60 ? '中性' : r <= 80 ? '偏高' : '极高'; }
function pcrColor(p: number) { return p < 0.7 ? '#28C840' : p < 1.0 ? '#FEBC2E' : '#FF5F57'; }
function pcrLabel(p: number) { return p < 0.7 ? '偏多' : p < 1.0 ? '中性' : '偏空'; }

// ── CoinTabs ──────────────────────────────────────────────────────────────────

const CoinTabs = ({ v }: { v: Coin; set: (c: Coin) => void }) => (
  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/[0.06] text-white/50 uppercase tracking-wider">
    {v}
  </span>
);

// ── Live badge ────────────────────────────────────────────────────────────────

const LiveBadge = () => (
  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />
    实时
  </span>
);

// ── Loading skeleton ───────────────────────────────────────────────────────────

const Skeleton = () => (
  <div className="w-full h-full flex flex-col gap-2 p-3 overflow-hidden">
    {/* shimmer sweep */}
    <div className="relative flex-1 min-h-0 rounded-[10px] overflow-hidden bg-white/[0.03]">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent animate-shimmer" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-2 w-1/3 rounded-full skel-block" />
        <div className="h-7 w-full rounded-[8px] skel-block" />
        <div className="grid grid-cols-3 gap-2 mt-1">
          <div className="h-6 rounded-[6px] skel-block" />
          <div className="h-6 rounded-[6px] skel-block" />
          <div className="h-6 rounded-[6px] skel-block" />
        </div>
        <div className="h-2 w-2/3 rounded-full skel-block mt-1" />
      </div>
    </div>
  </div>
);

// Shown when fetchDeribitHistory hasn't delivered data after 20s (API fail / network)
const HistLoadErr = () => (
  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-center px-4">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="opacity-40">
      <circle cx="10" cy="10" r="9" stroke="#FF5F57" strokeWidth="1.5"/>
      <path d="M10 5.5v5M10 13.5v1" stroke="#FF5F57" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
    <span className="text-[11px] text-white/55">历史数据加载失败</span>
    <span className="text-[10px] text-white/55">Deribit 历史 API 无响应，请刷新重试</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// SmileChart – real data version
// ═══════════════════════════════════════════════════════════════════════════════

// Delta "grid" for display: [10P, 25P, ATM, 25C, 10C] → target abs-deltas [.10, .25, .50, .25, .10]
// We plot call 25/10 and put 25/10 separately, ATM from calls
const SMILE_LABELS_LIVE = ['10P', '25P', 'ATM', '25C', '10C'] as const;

interface SmileRow { label: string; values: number[] /* per expiry line */ }

function buildSmileRows(expiries: ExpiryGroup[]): { rows: SmileRow[]; lines: { label: string; color: string }[] } {
  // Map [10P, 25P, ATM, 25C, 10C] → IV for each expiry
  const lines: { label: string; color: string }[] = expiries.map((e, i) => ({
    label: e.label,
    color: [BRAND, YELLOW, BLUE][i] ?? TXT,
  }));
  const rows: SmileRow[] = SMILE_LABELS_LIVE.map((lbl) => {
    const values = expiries.map(e => {
      if (lbl === 'ATM') return e.atmIV;
      const isCall = lbl.endsWith('C');
      const targetDelta = lbl.startsWith('10') ? 0.10 : 0.25;
      return closestDeltaIV(isCall ? e.calls : e.puts, targetDelta);
    });
    return { label: lbl, values };
  });
  return { rows, lines };
}

const SmileChartLive = React.memo(({
  expiries,
  onPick,
}: {
  expiries: ExpiryGroup[];
  onPick?: (p: { tenor: string; label: string; value: number }) => void;
}) => {
  if (!expiries.length) return <Skeleton />;
  const W = 500, H = 180, px = 36, py = 14;
  const { rows, lines } = buildSmileRows(expiries);

  // Collect all IVs to set y range
  const allIVs = rows.flatMap(r => r.values).filter(v => v > 0);
  if (!allIVs.length) return <Skeleton />;
  const lo = Math.floor(Math.min(...allIVs) / 5) * 5;
  const hi = Math.ceil(Math.max(...allIVs) / 5) * 5 + 5;

  function fy(v: number) { return (H - py) - ((v - lo) / (hi - lo)) * (H - 2 * py); }
  function fx(i: number) { return px + (i / (SMILE_LABELS_LIVE.length - 1)) * (W - 2 * px); }

  const yTicks = Array.from({ length: Math.round((hi - lo) / 5) + 1 }, (_, i) => lo + i * 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
      {/* Grid */}
      {yTicks.map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {/* X axis labels */}
      {SMILE_LABELS_LIVE.map((lbl, i) => (
        <text key={lbl} x={fx(i)} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{lbl}</text>
      ))}
      {/* Lines per expiry */}
      {lines.map((line, li) => {
        const pts: [number, number][] = rows.map((row, ri) => [fx(ri), fy(row.values[li] || lo)]);
        return (
          <React.Fragment key={line.label}>
            <path d={smooth(pts)} fill="none" stroke={line.color} strokeWidth={1.5}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            {pts.map(([x, y], ri) => (
              <circle key={ri} cx={x} cy={y} r={2.5} fill={line.color}
                className={onPick ? 'cursor-pointer' : ''}
                onClick={() => onPick?.({ tenor: line.label, label: rows[ri].label, value: rows[ri].values[li] })}
              />
            ))}
          </React.Fragment>
        );
      })}
      {/* Legend */}
      {lines.map((line, i) => (
        <React.Fragment key={line.label}>
          <line x1={px + i * 60} y1={9} x2={px + i * 60 + 12} y2={9} stroke={line.color} strokeWidth={1.5} />
          <text x={px + i * 60 + 15} y={12} fontSize={7} fill={TXT}>{line.label}</text>
        </React.Fragment>
      ))}
    </svg>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Historical charts – unchanged (use mock data)
// ═══════════════════════════════════════════════════════════════════════════════

const VRPChart = React.memo(({ data: d }: { data: { iv: number; rv: number }[] }) => {
  const W = 480, H = 140, px = 36, py = 12;
  const allV = d.flatMap(r => [r.iv, r.rv]);
  const lo = Math.floor(Math.min(...allV) / 5) * 5;
  const hi = Math.ceil(Math.max(...allV) / 5) * 5;
  const ivPts  = mapPts(d.map(r => r.iv), W, H, lo, hi, px, py);
  const rvPts  = mapPts(d.map(r => r.rv), W, H, lo, hi, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
      {[lo, lo + (hi - lo) / 2, hi].map(v => {
        const y = (H - py) - ((v - lo) / (hi - lo)) * (H - 2 * py);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v.toFixed(0)}</text>
        </React.Fragment>;
      })}
      <path d={area(ivPts, H, py)} fill="url(#wg-green)" />
      <polyline points={poly(ivPts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={poly(rvPts)} fill="none" stroke={YELLOW} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,2" />
      <line x1={px + 2} y1={9} x2={px + 14} y2={9} stroke={BRAND} strokeWidth={1.5} />
      <text x={px + 17} y={12} fontSize={7} fill={TXT}>IV</text>
      <line x1={px + 35} y1={9} x2={px + 47} y2={9} stroke={YELLOW} strokeWidth={1.2} strokeDasharray="4,2" />
      <text x={px + 50} y={12} fontSize={7} fill={TXT}>RV</text>
    </svg>
  );
});

const IVRankChart = React.memo(({ data: d }: { data: number[] }) => {
  const W = 900, H = 120, px = 40, py = 10;
  const pts = mapPts(d, W, H, 0, 100, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
      {[0, 30, 70, 100].map(v => {
        const y = (H - py) - (v / 100) * (H - 2 * py);
        const col = v === 30 ? 'rgba(37,232,137,0.3)' : v === 70 ? 'rgba(202,63,100,0.3)' : GRID;
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={col} strokeWidth={v === 30 || v === 70 ? 0.8 : 0.5} strokeDasharray={v === 30 || v === 70 ? '3,2' : undefined} />
          <text x={px - 6} y={y + 3.5} textAnchor="end" fontSize={8} fill={TXT}>{v}</text>
        </React.Fragment>;
      })}
      <path d={area(pts, H, py)} fill="url(#wg-green)" />
      <polyline points={poly(pts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

const VolConeChart = React.memo(({
  cone,
  currIVs,     // current ATM IV at each tenor (from options chain)
  tenorLabels, // e.g. ['7D','14D','30D','60D','90D','180D']
}: {
  cone: VolConeSlice;
  currIVs: number[];
  tenorLabels: string[];
}) => {
  const W = 380, H = 175, px = 32, py = 16;
  const allVals = [...cone.p90, ...currIVs].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;
  const hi = Math.ceil(Math.max(...allVals) / 10) * 10 + 5;
  function fy(v: number) { return (H - py) - (v / hi) * (H - 2 * py); }
  const n = cone.tenors.length;
  function fx(i: number) { return px + (i / (n - 1)) * (W - 2 * px); }
  const currPts = currIVs.map((v, i): [number, number] => [fx(i), fy(v)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
      {[0, 25, 50, 75, 100].filter(v => v <= hi).map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {cone.tenors.map((_, i) => {
        const x = fx(i);
        return (
          <React.Fragment key={i}>
            <rect x={x - 7} y={fy(cone.p90[i])} width={14} height={Math.max(0, fy(cone.p10[i]) - fy(cone.p90[i]))} rx={2} fill="rgba(37,232,137,0.07)" />
            <rect x={x - 7} y={fy(cone.p75[i])} width={14} height={Math.max(0, fy(cone.p25[i]) - fy(cone.p75[i]))} rx={2} fill="rgba(37,232,137,0.18)" />
            <line x1={x - 7} y1={fy(cone.p50[i])} x2={x + 7} y2={fy(cone.p50[i])} stroke="rgba(37,232,137,0.6)" strokeWidth={1.5} />
            <text x={x} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{tenorLabels[i] ?? `${cone.tenors[i]}D`}</text>
          </React.Fragment>
        );
      })}
      {currPts.length > 1 && (
        <polyline points={poly(currPts)} fill="none" stroke={YELLOW} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {currPts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={YELLOW} />)}
      <rect x={px} y={6} width={8} height={6} rx={1} fill="rgba(37,232,137,0.18)" />
      <text x={px + 11} y={11} fontSize={7} fill={TXT}>历史RV区间</text>
      <line x1={px + 70} y1={9} x2={px + 80} y2={9} stroke={YELLOW} strokeWidth={1.5} />
      <text x={px + 83} y={11} fontSize={7} fill={TXT}>当前IV</text>
    </svg>
  );
});
// ═══════════════════════════════════════════════════════════════════════════════
// useCoinControl + WidgetShell
// ═══════════════════════════════════════════════════════════════════════════════

type CoinControlProps = { coin?: Coin; onCoinChange?: (c: Coin) => void };

function useCoinControl({ coin: coinProp, onCoinChange }: CoinControlProps) {
  // coin 受控时直接跟随 prop（无需本地 state 同步 effect，少一次渲染）；
  // 非受控时用本地 state。
  const isControlled = coinProp !== undefined;
  const [localCoin, setLocalCoin] = useState<Coin>(coinProp ?? 'BTC');
  const coin = coinProp ?? localCoin;
  // onCoinChange 用 ref 持有，setCoin 依赖恒为空 → 引用永久稳定。
  // 否则父组件若传入内联箭头函数，setCoin 每次渲染都变 → WidgetShell 的
  // useEffect 反复执行 setHeaderRight → 重渲染 → 死循环。
  const onCoinChangeRef = useRef(onCoinChange);
  useEffect(() => { onCoinChangeRef.current = onCoinChange; }, [onCoinChange]);
  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;
  const setCoin = useCallback((c: Coin) => {
    if (!isControlledRef.current) setLocalCoin(c);
    onCoinChangeRef.current?.(c);
  }, []);
  return { coin, setCoin };
}

const WidgetShell = ({ children, coin, setCoin }: { children: React.ReactNode; coin: Coin; setCoin: (c: Coin) => void }) => {
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: select representative expiries
// ═══════════════════════════════════════════════════════════════════════════════

function pickExpiries(expiries: ExpiryGroup[], targets: number[]): ExpiryGroup[] {
  const result: ExpiryGroup[] = [];
  const used = new Set<number>();
  for (const t of targets) {
    if (!expiries.length) break;
    const e = expiries.reduce((best, ex) =>
      Math.abs(ex.daysToExp - t) < Math.abs(best.daysToExp - t) ? ex : best
    , expiries[0]);
    if (e && !used.has(e.daysToExp)) { result.push(e); used.add(e.daysToExp); }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VolOverviewWidget – real term structure + PCR, mock IVR/VRP
// ═══════════════════════════════════════════════════════════════════════════════

export const VolOverviewWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);
  const { data: histData } = useDeribitHistory(coin);
  const mock = VOL[coin];

  const hasLive = !!(data || histData);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {hasLive && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, hasLive]);

  // Real data when available, mock fallback
  const dvol      = data?.dvol30              ?? mock.dvol;
  const dvolChg   = histData?.dvolChange24h   ?? mock.dvolChange;
  const pcr       = data?.pcr                 ?? mock.pcr;
  const ivRank    = histData?.ivRankCurrent   ?? mock.ivRank;   // real 90D percentile
  const iv30      = data?.dvol30              ?? mock.iv30;

  // VRP: needs both DVOL and RV from history
  const lastVRP   = histData?.vrp[histData.vrp.length - 1];
  const rv30      = lastVRP?.rv ?? mock.rv30;
  const vrp       = lastVRP ? lastVRP.iv - lastVRP.rv : mock.vrp;

  const termItems = data
    ? pickExpiries(data.expiries, [7, 14, 30, 60, 90]).map(e => ({ t: e.label, iv: e.atmIV }))
    : mock.term.map(t => ({ t: t.t, iv: t.iv }));

  const ivrc = ivrColor(ivRank);
  const pcrc = pcrColor(pcr);
  const termMin   = Math.min(...termItems.map(t => t.iv));
  const termRange = Math.max(...termItems.map(t => t.iv)) - termMin || 1;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-y-auto">
      {loading && !data && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-[11px] text-white/55 animate-pulse">正在加载实时数据…</span>
        </div>
      )}
      <div className="flex items-center px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[10px] font-bold text-white/55 uppercase tracking-wider">波动率概览</span>
      </div>
      <div className="mx-2 mb-2 rounded-[8px] bg-surface-1/40 border border-surface-4/50 overflow-hidden shrink-0">
        {/* DVOL row */}
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-surface-2/80">
          <span className="text-[13px] font-bold text-white/90">{coin} {data ? 'ATM 30D' : 'DVOL'}</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-mono font-bold tnum text-white/90 leading-none">{dvol.toFixed(1)}</span>
            <span className="text-[11px] text-white/55">%</span>
            {histData && (
              <span className={cn('text-[11px] font-mono tnum font-bold', dvolChg < 0 ? 'text-[var(--nexus-red)]' : 'text-[var(--nexus-green)]')}>
                {dvolChg > 0 ? '+' : ''}{dvolChg.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        {/* Metrics grid */}
        <div className="grid grid-cols-3 divide-x divide-surface-2/80">
          {/* IV Rank */}
          <div className="py-2 px-3">
            <div className="flex items-center gap-1 mb-1">
              <div className="text-[9px] font-bold text-white/55 tracking-wider uppercase">IV Rank</div>
              {histData ? <LiveBadge /> : <span className="text-[9px] text-white/55">估</span>}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-1" style={{ color: ivrc }}>{ivRank.toFixed(0)}</div>
            <div className="h-1 rounded-full bg-surface-2/80 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${ivRank}%`, backgroundColor: ivrc }} />
            </div>
            <div className="text-[9px] font-mono mt-0.5" style={{ color: ivrc }}>{ivrLabel(ivRank)}</div>
          </div>
          {/* VRP */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-1 mb-1">
              <div className="text-[9px] font-bold text-white/55 tracking-wider uppercase">VRP</div>
              {histData ? <LiveBadge /> : <span className="text-[9px] text-white/55">估</span>}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none text-[var(--nexus-yellow)] mb-0.5">
              {vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}<span className="text-[10px] text-white/55 font-normal ml-0.5">pp</span>
            </div>
            <div className="text-[9px] font-mono text-white/55">IV {iv30.toFixed(1)} − RV {rv30.toFixed(1)}</div>
          </div>
          {/* PCR */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-1 mb-1">
              <div className="text-[9px] font-bold text-white/55 tracking-wider uppercase">PCR</div>
              {data && <LiveBadge />}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-0.5" style={{ color: pcrc }}>{pcr.toFixed(2)}</div>
            <div className="text-[9px] font-mono" style={{ color: pcrc }}>{pcrLabel(pcr)}</div>
          </div>
        </div>
        {/* Term structure */}
        <div className="border-t border-surface-2/80 px-3 pt-2 pb-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[9px] font-bold text-white/55 tracking-wider uppercase">期限结构 ATM IV</div>
            {data && <LiveBadge />}
          </div>
          <div className="flex gap-0.5 items-end h-[40px]">
            {termItems.map((t, i) => {
              const barH = Math.round(8 + ((t.iv - termMin) / termRange) * 26);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-mono tnum text-white/55 leading-none">{t.iv.toFixed(0)}</span>
                  <div className="w-full rounded-t-[2px]" style={{ height: barH, background: 'linear-gradient(to top,rgba(37,232,137,.55),rgba(37,232,137,.2))' }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-0.5 mt-0.5">
            {termItems.map((t, i) => (
              <div key={i} className="flex-1 flex justify-center">
                <span className="text-[9px] text-white/55">{t.t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// VolSmileWidget – real smile data
// ═══════════════════════════════════════════════════════════════════════════════

export const VolSmileWidget = ({
  coin: coinProp, onCoinChange, onPickSmilePoint,
}: CoinControlProps & {
  onPickSmilePoint?: (p: { coin: Coin; tenor: string; label: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);

  const expiries = data
    ? pickExpiries(data.expiries, [7, 30, 90])
    : [];

  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      {loading && !data
        ? <Skeleton />
        : <SmileChartLive
            expiries={expiries}
            onPick={p => onPickSmilePoint?.({ coin, ...p })}
          />
      }
    </WidgetShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// History widgets – unchanged, use mock
// ═══════════════════════════════════════════════════════════════════════════════

export const VRPHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const vrpData = histData?.vrp ?? VRP_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden px-3 pb-2">
      <div className="flex-1 min-h-0 overflow-hidden">
        <VRPChart data={vrpData} />
      </div>
    </div>
  );
};

export const IVRankHistoryWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const ivrData = histData?.ivr ?? IVR_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden px-3 pb-2">
      <div className="flex-1 min-h-0 overflow-hidden">
        <IVRankChart data={ivrData} />
      </div>
    </div>
  );
};

const CONE_TENOR_TARGETS = [7, 14, 30, 60, 90, 180];

export const VolConeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { data: optData } = useDeribitOptions(coin);
  const mockCone = VOL_CONE[coin];
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  // Current IV line: match each CONE_TENOR_TARGETS day to nearest options expiry
  const currIVs: number[] = CONE_TENOR_TARGETS.map(t => {
    if (optData?.expiries.length) {
      const closest = optData.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - t) < Math.abs(best.daysToExp - t) ? e : best
      );
      return closest.atmIV;
    }
    const idx = mockCone.tenors.indexOf(`${t}D` as any);
    return mockCone.curr[idx] ?? mockCone.curr[0];
  });

  // Use real cone if available, otherwise mock
  const cone: VolConeSlice = histData?.volCone ?? {
    tenors: CONE_TENOR_TARGETS,
    p10: mockCone.p10, p25: mockCone.p25, p50: mockCone.p50,
    p75: mockCone.p75, p90: mockCone.p90,
  };
  const labels = CONE_TENOR_TARGETS.map(t => `${t}D`);

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden px-2 pb-1">
      <div className="flex-1 min-h-0 overflow-hidden">
        {histData
          ? <VolConeChart cone={cone} currIVs={currIVs} tenorLabels={labels} />
          : <VolConeChart
              cone={cone}
              currIVs={mockCone.curr}
              tenorLabels={mockCone.tenors as unknown as string[]}
            />
        }
      </div>
    </div>
  );
};
// ═══════════════════════════════════════════════════════════════════════════════
// IVSurfaceWidget – real data
// ═══════════════════════════════════════════════════════════════════════════════

const SURFACE_ROWS: { label: string; type: 'C' | 'P'; delta: number }[] = [
  { label: '10P', type: 'P', delta: 0.10 },
  { label: '25P', type: 'P', delta: 0.25 },
  { label: 'ATM', type: 'C', delta: 0.50 },
  { label: '25C', type: 'C', delta: 0.25 },
  { label: '10C', type: 'C', delta: 0.10 },
];

export const IVSurfaceWidget = ({
  coin: coinProp, onCoinChange, onPickCell,
}: CoinControlProps & {
  onPickCell?: (p: { coin: Coin; row: string; col: string; value: number }) => void;
}) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) {
    return <div className="p-6"><Skeleton /></div>;
  }

  const cols = data
    ? pickExpiries(data.expiries, [7, 14, 30, 60, 90])
    : [];

  // Collect all values for heat-map coloring
  const tableData: number[][] = SURFACE_ROWS.map(row =>
    cols.map(exp => {
      if (row.label === 'ATM') return exp.atmIV;
      return closestDeltaIV(row.type === 'C' ? exp.calls : exp.puts, row.delta);
    })
  );
  const allVals = tableData.flat().filter(v => v > 0);
  const lo = allVals.length ? Math.min(...allVals) : 0;
  const hi = allVals.length ? Math.max(...allVals) : 100;

  return (
    <div className="overflow-hidden rounded-[18px]" style={{ backgroundColor: 'rgba(37,232,137,0.04)' }}>
      <div className="w-full overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 text-white/55 font-bold">Δ / Exp</th>
              {cols.map(e => (
                <th key={e.label} className="px-2 py-1.5 text-white/55 font-bold text-right">{e.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SURFACE_ROWS.map((row, ri) => (
              <tr key={row.label} className={ri === 2 ? 'border-t border-b border-border-subtle' : ''}>
                <td className={cn('px-2 py-1.5 font-mono font-bold', ri === 2 ? 'text-white/80' : 'text-white/55')}>
                  {row.label}
                </td>
                {tableData[ri].map((v, ci) => (
                  <td
                    key={ci}
                    role={onPickCell ? 'button' : undefined}
                    tabIndex={onPickCell ? 0 : undefined}
                    className={cn(
                      'px-2 py-1.5 text-right font-mono tnum text-white/85 font-bold',
                      onPickCell && 'cursor-pointer hover:brightness-110',
                    )}
                    style={{ backgroundColor: `rgba(37,232,137,${(0.05 + (v - lo) / (hi - lo + 0.01) * 0.35).toFixed(2)})` }}
                    onClick={() => onPickCell?.({ coin, row: row.label, col: cols[ci]?.label ?? '', value: v })}
                    onKeyDown={e => {
                      if (!onPickCell) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickCell({ coin, row: row.label, col: cols[ci]?.label ?? '', value: v }); }
                    }}
                  >
                    {v > 0 ? v.toFixed(1) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// OptionsSkewWidget – real data
// ═══════════════════════════════════════════════════════════════════════════════

export const OptionsSkewWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  // Pick up to 6 expiries spread across the term structure
  const rows = data
    ? pickExpiries(data.expiries, [7, 14, 30, 60, 90, 180]).map(e => ({
        exp: e.label,
        atm: e.atmIV,
        rr25: e.rr25,
        bf25: e.bf25,
        rr10: e.rr10,
        bf10: e.bf10,
      }))
    : [];

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      {loading && !data
        ? <Skeleton />
        : (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['到期', 'ATM', '25d RR', '25d BF', '10d RR', '10d BF'].map(h => (
                    <th key={h} className="px-2 py-1.5 text-white/55 font-bold text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-2 transition-colors">
                    <td className="px-2 py-1.5 font-mono font-bold text-white/65">{r.exp}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-white/85 font-bold">{r.atm.toFixed(1)}</td>
                    <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr25 < 0 ? 'text-[var(--nexus-red)]' : 'text-[var(--nexus-green)]')}>{r.rr25.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-[var(--nexus-yellow)] font-bold">{r.bf25.toFixed(1)}</td>
                    <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr10 < 0 ? 'text-[var(--nexus-red)]/70' : 'text-[var(--nexus-green)]/70')}>{r.rr10.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-[var(--nexus-yellow)]/70 font-bold">{r.bf10.toFixed(1)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-white/55 text-[11px]">暂无数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// LiveOptionsChainWidget – near-ATM options chain table
// ═══════════════════════════════════════════════════════════════════════════════

export const LiveOptionsChainWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [selectedExp, setSelectedExp] = useState<number>(0); // index into expiries

  const expiries = data ? data.expiries.slice(0, 6) : [];
  const exp = expiries[selectedExp] ?? expiries[0];
  const spot = data?.spot ?? 0;

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setSelectedExp(0); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!exp) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  // Build merged strike table
  const callsByStrike = new Map<number, typeof exp.calls[0]>();
  const putsByStrike  = new Map<number, typeof exp.puts[0]>();
  exp.calls.forEach(o => callsByStrike.set(o.strike, o));
  exp.puts.forEach(o => putsByStrike.set(o.strike, o));

  // All strikes within ±25% of spot
  const allStrikes = [...new Set([...callsByStrike.keys(), ...putsByStrike.keys()])]
    .filter(k => k >= spot * 0.75 && k <= spot * 1.25)
    .sort((a, b) => b - a); // descending

  const atmStrike = allStrikes.reduce(
    (best, k) => Math.abs(k - spot) < Math.abs(best - spot) ? k : best,
    allStrikes[0] ?? spot,
  );

  const fmt = (v: number) => v > 0 ? v.toFixed(1) : '—';
  const fmtOI = (v: number) => v > 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
        {expiries.map((e, i) => (
          <button
            key={e.label}
            onClick={() => setSelectedExp(i)}
            className={cn(
              'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
              i === selectedExp
                ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
                : 'text-white/55 hover:text-white/60 hover:bg-white/[0.04]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Chain table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0" style={{ background: 'var(--base-dim)' }}>
            <tr className="border-b border-white/[0.06]">
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">IV%</th>
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">Δ</th>
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">OI</th>
              <th className="text-center px-3 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-semibold bg-white/[0.03]">行权价</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">OI</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">Δ</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/55 font-normal">IV%</th>
            </tr>
            <tr className="border-b border-white/[0.03]">
              <th colSpan={3} className="text-center py-0.5 text-[9px] text-[var(--nexus-green)]/40 font-normal">CALL</th>
              <th className="bg-white/[0.03]" />
              <th colSpan={3} className="text-center py-0.5 text-[9px] text-[var(--nexus-red)]/40 font-normal">PUT</th>
            </tr>
          </thead>
          <tbody>
            {allStrikes.map(strike => {
              const call = callsByStrike.get(strike);
              const put  = putsByStrike.get(strike);
              const isAtm = strike === atmStrike;
              const aboveSpot = strike > spot;
              return (
                <tr
                  key={strike}
                  className={cn(
                    'border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]',
                    isAtm && 'bg-[var(--nexus-accent)]/[0.04]',
                  )}
                >
                  {/* Call side */}
                  <td className={cn('text-right px-2 py-1.5 font-mono tnum', aboveSpot ? 'text-white/55' : 'text-[var(--nexus-green)]/80')}>
                    {call ? fmt(call.iv) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/55">
                    {call ? call.delta.toFixed(2) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/55">
                    {call ? fmtOI(call.oi) : '—'}
                  </td>
                  {/* Strike */}
                  <td className={cn(
                    'text-center px-3 py-1.5 font-mono font-bold bg-white/[0.03]',
                    isAtm ? 'text-[var(--nexus-accent)]' : 'text-white/70',
                  )}>
                    {strike.toLocaleString()}
                    {isAtm && <span className="ml-1 text-[9px] text-[var(--nexus-accent)]/60">ATM</span>}
                  </td>
                  {/* Put side */}
                  <td className="text-left px-2 py-1.5 font-mono tnum text-white/55">
                    {put ? fmtOI(put.oi) : '—'}
                  </td>
                  <td className="text-left px-2 py-1.5 font-mono tnum text-white/55">
                    {put ? put.delta.toFixed(2) : '—'}
                  </td>
                  <td className={cn('text-left px-2 py-1.5 font-mono tnum', aboveSpot ? 'text-[var(--nexus-red)]/80' : 'text-white/55')}>
                    {put ? fmt(put.iv) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        现货 {spot > 0 ? spot.toLocaleString() : '—'} · {exp.label} 到期 · OI 单位：张
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// OIByStrikeWidget – diverging bar chart: call OI vs put OI by strike + max pain
// ═══════════════════════════════════════════════════════════════════════════════

function computeMaxPain(
  calls: { strike: number; oi: number }[],
  puts:  { strike: number; oi: number }[],
  candidates: number[],
): number {
  let minPain = Infinity;
  let maxPainStrike = candidates[0] ?? 0;
  for (const P of candidates) {
    let pain = 0;
    for (const c of calls) pain += Math.max(0, P - c.strike) * c.oi;
    for (const p of puts)  pain += Math.max(0, p.strike - P) * p.oi;
    if (pain < minPain) { minPain = pain; maxPainStrike = P; }
  }
  return maxPainStrike;
}

export const OIByStrikeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  // 'all' = aggregate all expiries; or a specific expiry label
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 8) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;

  // Aggregate OI by strike for selected expiries
  const callOI = new Map<number, number>();
  const putOI  = new Map<number, number>();

  const targetExps = expFilter === 'all'
    ? expiries
    : expiries.filter(e => e.label === expFilter);

  for (const e of targetExps) {
    for (const o of e.calls) {
      callOI.set(o.strike, (callOI.get(o.strike) ?? 0) + o.oi);
    }
    for (const o of e.puts) {
      putOI.set(o.strike, (putOI.get(o.strike) ?? 0) + o.oi);
    }
  }

  // Filter to ±35% of spot
  const strikes = [...new Set([...callOI.keys(), ...putOI.keys()])]
    .filter(k => k >= spot * 0.65 && k <= spot * 1.35)
    .sort((a, b) => a - b);

  // Max pain
  const callArr = strikes.map(k => ({ strike: k, oi: callOI.get(k) ?? 0 }));
  const putArr  = strikes.map(k => ({ strike: k, oi: putOI.get(k)  ?? 0 }));
  const maxPain = computeMaxPain(callArr, putArr, strikes);

  const maxCallOI = Math.max(...strikes.map(k => callOI.get(k) ?? 0), 1);
  const maxPutOI  = Math.max(...strikes.map(k => putOI.get(k)  ?? 0), 1);
  const maxOI     = Math.max(maxCallOI, maxPutOI);

  const totalCallOI = callArr.reduce((s, o) => s + o.oi, 0);
  const totalPutOI  = putArr.reduce((s, o) => s + o.oi, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const BAR_H = 16;
  const GAP = 2;
  const ROW_H = BAR_H + GAP;
  const LEFT_W = 120; // put bars max width
  const RIGHT_W = 120; // call bars max width
  const LABEL_W = 80;
  const TOTAL_W = LEFT_W + LABEL_W + RIGHT_W;
  const CHART_H = strikes.length * ROW_H;

  const fmtOI = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const fmtPrice = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry filter tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
        <button
          onClick={() => setExpFilter('all')}
          className={cn(
            'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
            expFilter === 'all'
              ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
              : 'text-white/55 hover:text-white/60 hover:bg-white/[0.04]',
          )}
        >全部</button>
        {expiries.map(e => (
          <button
            key={e.label}
            onClick={() => setExpFilter(e.label)}
            className={cn(
              'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
              expFilter === e.label
                ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
                : 'text-white/55 hover:text-white/60 hover:bg-white/[0.04]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 px-3 pb-2 text-[10px] shrink-0">
        <span className="text-white/55">Call OI <span className="font-mono text-[var(--nexus-green)]/80">{fmtOI(totalCallOI)}</span></span>
        <span className="text-white/55">·</span>
        <span className="text-white/55">Put OI <span className="font-mono text-[var(--nexus-red)]/80">{fmtOI(totalPutOI)}</span></span>
        <span className="text-white/55">·</span>
        <span className="text-white/55">PCR <span className="font-mono text-[var(--nexus-yellow)]/80">{pcr.toFixed(2)}</span></span>
        <span className="text-white/55">·</span>
        <span className="text-white/55">最大痛点 <span className="font-mono text-[var(--nexus-accent)]/80">{maxPain.toLocaleString()}</span></span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/55">暂无持仓数据</div>
          : (
            <svg
              viewBox={`0 0 ${TOTAL_W} ${CHART_H}`}
              width="100%"
              style={{ height: Math.min(CHART_H, 600) }}
            >
              {strikes.map((strike, i) => {
                const y = i * ROW_H;
                const cOI = callOI.get(strike) ?? 0;
                const pOI = putOI.get(strike)  ?? 0;
                const callBarW = (cOI / maxOI) * RIGHT_W;
                const putBarW  = (pOI / maxOI) * LEFT_W;
                const isSpot    = Math.abs(strike - spot)    < spot * 0.005;
                const isMaxPain = Math.abs(strike - maxPain) < spot * 0.005;
                const labelColor = isSpot ? '#FEBC2E' : isMaxPain ? 'rgba(37,232,137,0.9)' : 'rgba(255,255,255,0.45)';

                return (
                  <g key={strike}>
                    {/* Put bar – left, aligned right to LABEL_W start */}
                    <rect
                      x={LEFT_W - putBarW}
                      y={y + 1}
                      width={putBarW}
                      height={BAR_H - 2}
                      rx={2}
                      fill={`rgba(202,63,100,${0.45 + (pOI / maxOI) * 0.35})`}
                    />
                    {/* Call bar – right */}
                    <rect
                      x={LEFT_W + LABEL_W}
                      y={y + 1}
                      width={callBarW}
                      height={BAR_H - 2}
                      rx={2}
                      fill={`rgba(37,232,137,${0.4 + (cOI / maxOI) * 0.4})`}
                    />
                    {/* Strike label */}
                    <text
                      x={LEFT_W + LABEL_W / 2}
                      y={y + BAR_H / 2 + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={isSpot || isMaxPain ? 'bold' : 'normal'}
                      fontFamily="monospace"
                      fill={labelColor}
                    >
                      {fmtPrice(strike)}
                      {isSpot    && ' ◆'}
                      {isMaxPain && !isSpot && ' ★'}
                    </text>
                    {/* OI labels */}
                    {pOI > 0 && (
                      <text x={LEFT_W - putBarW - 2} y={y + BAR_H / 2 + 3.5} textAnchor="end" fontSize={8} fill="rgba(202,63,100,0.6)">
                        {fmtOI(pOI)}
                      </text>
                    )}
                    {cOI > 0 && (
                      <text x={LEFT_W + LABEL_W + callBarW + 2} y={y + BAR_H / 2 + 3.5} fontSize={8} fill="rgba(37,232,137,0.55)">
                        {fmtOI(cOI)}
                      </text>
                    )}
                    {/* Separator */}
                    <line x1={0} y1={y + ROW_H - 0.5} x2={TOTAL_W} y2={y + ROW_H - 0.5} stroke="rgba(255,255,255,0.03)" strokeWidth={0.5} />
                  </g>
                );
              })}
            </svg>
          )
        }
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        ◆ 现货价  ★ 最大痛点  数据来源：Deribit · {expFilter === 'all' ? '全部到期日' : expFilter}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Block Trade Feed — 实时大宗成交
// ═══════════════════════════════════════════════════════════════════════════════

interface BlockTrade {
  tradeId: string;
  instrument: string;
  direction: 'buy' | 'sell';
  amount: number;        // contracts (= underlying units on Deribit)
  price: number;         // in underlying (fraction)
  iv: number;
  indexPrice: number;
  ts: number;
  strike: number;
  expiry: string;
  optType: 'C' | 'P';
  notionalUSD: number;   // amount × indexPrice
  premiumUSD: number;    // amount × price × indexPrice
}

// BT_MIN_USD — default minimum notional for BlockTradeWidget filter
const BT_MIN_USD = 50_000;

// useBlockTrades now derives from the shared WS option-trade stream (useOptionTradesWS).
// No separate REST polling or OPT_STREAM reference needed.
function useBlockTrades(coin: Coin, minUSD = BT_MIN_USD) {
  const allTrades = useOptionTradesWS(coin);
  const trades = useMemo<BlockTrade[]>(() =>
    allTrades
      .filter(t => t.notionalUSD >= minUSD)
      .slice(0, 120)
      .map(t => ({
        tradeId: t.id, instrument: t.instrument,
        direction: t.direction, amount: t.amount, price: t.price,
        iv: t.iv, indexPrice: t.indexPrice, ts: t.ts,
        strike: t.strike, expiry: t.expiry, optType: t.optType,
        notionalUSD: t.notionalUSD, premiumUSD: t.premiumUSD,
      })),
    [allTrades, minUSD],
  );
  return { trades, loading: allTrades.length === 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FlowData — 资金费率 + 期货基差 + Fear & Greed
// ═══════════════════════════════════════════════════════════════════════════════

interface FundingPoint { ts: number; rate: number; }  // rate = 8h rate in %

interface BasisPoint { label: string; daysToExp: number; annBasis: number; spot: number; futurePx: number; }

interface FearGreedPoint { value: number; label: string; ts: number; }

interface FlowData {
  fundingHistory: FundingPoint[];   // last ~90 8h periods
  currentFunding8h: number;         // latest 8h rate %
  annFunding: number;               // annualised %
  basis: BasisPoint[];              // per futures expiry
  fearGreed: FearGreedPoint[];      // last 30 days
  currentFG: number;                // latest value 0-100
  currentFGLabel: string;
  fetchedAt: number;
}

const FLOW_CACHE = new Map<string, { data: FlowData; ts: number }>();
const FLOW_TTL = 300_000; // 300s — historical funding + Fear & Greed rarely change

const MONTH_MAP_FUTURES: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseFuturesExpiry(instrName: string): number | null {
  // e.g. BTC-27JUN25  →  days to expiry
  const parts = instrName.split('-');
  if (parts.length < 2 || parts[1] === 'PERPETUAL') return null;
  const s = parts[1];
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP_FUTURES[s.slice(2, 5)];
  const yr = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const exp = new Date(Date.UTC(yr, mon, day, 8, 0, 0));
  return (exp.getTime() - Date.now()) / 86_400_000;
}

async function fetchFlowData(currency: 'BTC' | 'ETH'): Promise<FlowData> {
  const cached = FLOW_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < FLOW_TTL) return cached.data;

  const now = Date.now();
  const perp = `${currency}-PERPETUAL`;
  const d90ago = now - 90 * 86_400_000;

  const [fundingResp, futuresResp, fgResp] = await Promise.allSettled([
    fetch(`https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${perp}&start_timestamp=${d90ago}&end_timestamp=${now}&count=270`),
    fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=future`),
    fetch('https://api.alternative.me/fng/?limit=30'),
  ]);

  // ── Funding rate ──────────────────────────────────────────────────────────
  let fundingHistory: FundingPoint[] = [];
  let currentFunding8h = 0;
  let annFunding = 0;
  if (fundingResp.status === 'fulfilled') {
    const json = await fundingResp.value.json().catch(() => null);
    const raw: Array<{ timestamp: number; interest_8h: number }> = json?.result ?? [];
    fundingHistory = raw.map(r => ({ ts: r.timestamp, rate: r.interest_8h * 100 }));
    if (fundingHistory.length) {
      currentFunding8h = fundingHistory[fundingHistory.length - 1].rate;
      annFunding = currentFunding8h * 3 * 365; // 3 × per day × 365
    }
  }

  // ── Futures basis ─────────────────────────────────────────────────────────
  let basis: BasisPoint[] = [];
  if (futuresResp.status === 'fulfilled') {
    const json = await futuresResp.value.json().catch(() => null);
    const raw: any[] = json?.result ?? [];
    basis = raw
      .map((item: any) => {
        const days = parseFuturesExpiry(item.instrument_name);
        if (days === null || days < 1) return null;
        const futurePx: number = item.mark_price ?? 0;
        const spot: number = item.underlying_price ?? futurePx;
        if (!futurePx || !spot) return null;
        const annBasis = ((futurePx / spot - 1) * (365 / days)) * 100;
        return {
          label: item.instrument_name.split('-').slice(1).join('-'),
          daysToExp: Math.round(days),
          annBasis,
          spot,
          futurePx,
        } as BasisPoint;
      })
      .filter((b): b is BasisPoint => b !== null)
      .sort((a, b) => a.daysToExp - b.daysToExp)
      .slice(0, 6);
  }

  // ── Fear & Greed ──────────────────────────────────────────────────────────
  let fearGreed: FearGreedPoint[] = [];
  let currentFG = 50;
  let currentFGLabel = 'Neutral';
  if (fgResp.status === 'fulfilled') {
    const json = await fgResp.value.json().catch(() => null);
    const raw: Array<{ value: string; value_classification: string; timestamp: string }> = json?.data ?? [];
    fearGreed = raw
      .map(d => ({ value: parseInt(d.value), label: d.value_classification, ts: parseInt(d.timestamp) * 1000 }))
      .reverse(); // oldest first
    if (fearGreed.length) {
      currentFG = fearGreed[fearGreed.length - 1].value;
      currentFGLabel = fearGreed[fearGreed.length - 1].label;
    }
  }

  const data: FlowData = {
    fundingHistory, currentFunding8h, annFunding,
    basis, fearGreed, currentFG, currentFGLabel, fetchedAt: now,
  };
  FLOW_CACHE.set(currency, { data, ts: now });
  return data;
}

function useFlowData(coin: Coin) {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const currency = coin === 'BTC' ? 'BTC' : 'ETH';

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      `flow-${currency}`,
      () => fetchFlowData(currency),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, [currency]);

  return { data, loading };
}

// ── Fear & Greed standalone hook — reuses the shared flow-BTC poller ──────────
function useFearGreed() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      'flow-BTC',
      () => fetchFlowData('BTC'),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, []);
  return { data, loading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEXWidget — Gamma Exposure by Strike
// ═══════════════════════════════════════════════════════════════════════════════

export const GEXWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 6) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  const targetExps = expFilter === 'all' ? expiries : expiries.filter(e => e.label === expFilter);

  // GEX by strike: Σ(gamma × OI × S²/100) for calls (positive) and puts (negative)
  const gexMap = new Map<number, { cGex: number; pGex: number }>();
  for (const exp of targetExps) {
    for (const opt of [...exp.calls, ...exp.puts]) {
      const g = bsGamma(spot, opt.strike, opt.T, opt.iv) * spot * spot / 100;
      if (!gexMap.has(opt.strike)) gexMap.set(opt.strike, { cGex: 0, pGex: 0 });
      const e = gexMap.get(opt.strike)!;
      if (opt.type === 'C') e.cGex += g * opt.oi;
      else                   e.pGex += g * opt.oi;
    }
  }

  const strikes = [...gexMap.keys()]
    .filter(k => k >= spot * 0.70 && k <= spot * 1.30)
    .sort((a, b) => a - b);

  const netGex = strikes.map(k => {
    const e = gexMap.get(k)!;
    return e.cGex - e.pGex;
  });
  const totalNet = netGex.reduce((s, g) => s + g, 0);

  // Zero-gamma level (linear interpolation between sign-change neighbours)
  let zeroGamma: number | null = null;
  for (let i = 1; i < strikes.length; i++) {
    if (netGex[i - 1] * netGex[i] < 0) {
      const frac = Math.abs(netGex[i - 1]) / (Math.abs(netGex[i - 1]) + Math.abs(netGex[i]));
      zeroGamma = strikes[i - 1] + frac * (strikes[i] - strikes[i - 1]);
      break;
    }
  }

  const maxAbs = Math.max(...netGex.map(Math.abs), 1);
  const fmtGex = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const BAR_H = 15, GAP = 3, ROW_H = BAR_H + GAP;
  const MAX_BAR = 130;
  const LABEL_W = 72;
  const CHART_H = strikes.length * ROW_H;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry filter */}
      <div className="flex items-center gap-1 px-3 py-1.5 shrink-0 border-b border-white/[0.04]">
        {['all', ...expiries.map(e => e.label)].map(f => (
          <button key={f} onClick={() => setExpFilter(f as 'all' | string)}
            className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[6px] transition-colors',
              expFilter === f ? 'bg-white/10 text-white/80' : 'text-white/55 hover:text-white/50'
            )}>
            {f === 'all' ? '全部' : f}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex gap-2 px-3 py-2 shrink-0">
        {[
          { label: '净 GEX', val: fmtGex(totalNet), color: totalNet >= 0 ? '#25e889' : '#FF5F57' },
          { label: '零 Gamma', val: zeroGamma ? fmtPx(zeroGamma) : '—', color: '#FEBC2E' },
          { label: '现货', val: fmtPx(spot), color: 'rgba(255,255,255,0.6)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* GEX chart */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        <svg width="100%" viewBox={`0 0 ${MAX_BAR * 2 + LABEL_W} ${CHART_H}`} style={{ display: 'block', minHeight: CHART_H }}>
          {/* Centre line */}
          <line x1={MAX_BAR} y1={0} x2={MAX_BAR} y2={CHART_H} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

          {strikes.map((k, i) => {
            const y = i * ROW_H;
            const net = netGex[i];
            const barW = Math.abs(net) / maxAbs * (MAX_BAR - 2);
            const isPos = net >= 0;
            const barX = isPos ? MAX_BAR : MAX_BAR - barW;
            const isSpot = Math.abs(k - spot) / spot < 0.005;
            const isZero = zeroGamma !== null && Math.abs(k - zeroGamma) / spot < 0.005;
            const barColor = isPos ? 'rgba(37,232,137,0.7)' : 'rgba(248,113,113,0.7)';

            return (
              <g key={k}>
                <rect x={barX} y={y + 1} width={barW} height={BAR_H - 2} fill={barColor} rx={2} />
                {/* Strike label */}
                <text
                  x={MAX_BAR + LABEL_W / 2}
                  y={y + BAR_H / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isSpot ? '#FEBC2E' : isZero ? '#a78bfa' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isSpot || isZero ? 700 : 400}
                >
                  {fmtPx(k)}{isSpot ? ' ◆' : isZero ? ' ○' : ''}
                </text>
                {/* Value label */}
                {Math.abs(net) / maxAbs > 0.12 && (
                  <text
                    x={isPos ? barX + barW + 2 : barX - 2}
                    y={y + BAR_H / 2 + 3.5}
                    textAnchor={isPos ? 'start' : 'end'}
                    fontSize={7.5}
                    fill={isPos ? 'rgba(37,232,137,0.5)' : 'rgba(248,113,113,0.5)'}
                  >
                    {fmtGex(net)}
                  </text>
                )}
                <line x1={0} y1={y + ROW_H - 0.5} x2={MAX_BAR * 2 + LABEL_W} y2={y + ROW_H - 0.5} stroke="rgba(255,255,255,0.025)" strokeWidth={0.5} />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        ◆ 现货  ○ 零Gamma  GEX = Γ × OI × S² / 100（每1%标的波动）· Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DVOLSeriesWidget — DVOL 90D 时间序列
// ═══════════════════════════════════════════════════════════════════════════════

export const DVOLSeriesWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData, timedOut } = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  if (!histData) return timedOut ? <HistLoadErr /> : <Skeleton />;

  const dvol = histData.dvolSeries;
  const rv30 = histData.rv30Series;
  if (!dvol.length) return <Skeleton />;

  const n = dvol.length;
  const allVals = [...dvol, ...rv30.filter(v => v > 0)];
  const lo = Math.floor(Math.min(...allVals) * 0.95);
  const hi = Math.ceil(Math.max(...allVals) * 1.05);
  const W = 480, H = 140, PX = 8, PY = 12;

  const dvolPts = mapPts(dvol, W, H, lo, hi, PX, PY);
  const rv30Aligned = rv30.length >= n ? rv30.slice(-n) : [...Array(n - rv30.length).fill(rv30[0] ?? lo), ...rv30];
  const rvPts = mapPts(rv30Aligned, W, H, lo, hi, PX, PY);

  const currDvol = dvol[dvol.length - 1];
  const currRv = rv30[rv30.length - 1];
  const vrp = currDvol - currRv;

  // Grid lines
  const gridVals = Array.from({ length: 5 }, (_, i) => lo + (i * (hi - lo)) / 4);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: 'DVOL 当前', val: `${currDvol.toFixed(1)}%`, color: BRAND },
          { label: 'RV30 当前', val: `${currRv.toFixed(1)}%`, color: BLUE },
          { label: 'VRP', val: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}%`, color: vrp >= 0 ? '#25e889' : '#FF5F57' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-3 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* Grid */}
          {gridVals.map(v => {
            const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
            return (
              <g key={v}>
                <line x1={PX} y1={y} x2={W - PX} y2={y} stroke={GRID} strokeWidth={0.5} />
                <text x={PX} y={y - 2} fontSize={8} fill={TXT}>{v.toFixed(0)}</text>
              </g>
            );
          })}
          {/* RV30 area */}
          <path d={area(rvPts, H, PY)} fill="url(#wg-blue)" />
          <polyline points={poly(rvPts)} fill="none" stroke={BLUE} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />
          {/* DVOL area */}
          <path d={area(dvolPts, H, PY)} fill="url(#wg-green)" />
          <polyline points={poly(dvolPts)} fill="none" stroke={BRAND} strokeWidth={1.5} opacity={0.9} />
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 pb-2 shrink-0">
        {[{ c: BRAND, l: 'DVOL (Deribit)' }, { c: BLUE, l: 'RV 30D', dash: true }].map(({ c, l, dash }) => (
          <div key={l} className="flex items-center gap-1.5">
            <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke={c} strokeWidth={1.5} strokeDasharray={dash ? '3,2' : undefined} /></svg>
            <span className="text-[9px] text-white/55">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FundingRateWidget — 资金费率历史
// ═══════════════════════════════════════════════════════════════════════════════

export const FundingRateWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fundingHistory.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无资金费率数据</div>
  );

  const hist = data.fundingHistory;
  // Downsample to last 90 points for readability
  const pts = hist.slice(-90);
  const rates = pts.map(p => p.rate);
  const maxAbs = Math.max(Math.max(...rates.map(Math.abs)), 0.05);
  const W = 480, H = 120, PX = 6, PY = 10;
  const mid = H / 2;

  // Map each rate to Y
  const mapY = (r: number) => mid - (r / maxAbs) * (mid - PY);
  const mapped: [number, number][] = rates.map((r, i) => [
    PX + (i / Math.max(rates.length - 1, 1)) * (W - 2 * PX),
    mapY(r),
  ]);

  // Split into positive/negative areas
  const posArea = `M ${mapped[0][0].toFixed(1)} ${mid} ${mapped.map(([x, y]) => `L ${x.toFixed(1)} ${Math.min(y, mid).toFixed(1)}`).join(' ')} L ${mapped[mapped.length - 1][0].toFixed(1)} ${mid} Z`;
  const negArea = `M ${mapped[0][0].toFixed(1)} ${mid} ${mapped.map(([x, y]) => `L ${x.toFixed(1)} ${Math.max(y, mid).toFixed(1)}`).join(' ')} L ${mapped[mapped.length - 1][0].toFixed(1)} ${mid} Z`;

  const fmtRate = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(4)}%`;
  const fundColor = data.currentFunding8h >= 0 ? '#25e889' : '#FF5F57';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 8H 费率', val: fmtRate(data.currentFunding8h), color: fundColor },
          { label: '年化费率', val: `${data.annFunding >= 0 ? '+' : ''}${data.annFunding.toFixed(1)}%`, color: fundColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-3 pb-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* Zero line */}
          <line x1={PX} y1={mid} x2={W - PX} y2={mid} stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} />
          {/* Positive fill (positive = longs pay shorts = bullish) */}
          <path d={posArea} fill="rgba(37,232,137,0.12)" />
          {/* Negative fill */}
          <path d={negArea} fill="rgba(248,113,113,0.12)" />
          {/* Line */}
          <polyline
            points={mapped.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={fundColor}
            strokeWidth={1.5}
            opacity={0.85}
          />
          {/* Y labels */}
          {[maxAbs, 0, -maxAbs].map(v => {
            const y = mapY(v);
            return (
              <text key={v} x={PX} y={y - 2} fontSize={8} fill={TXT}>{fmtRate(v)}</text>
            );
          })}
        </svg>
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/55 shrink-0">
        8小时资金费率（正值 = 多头付空头）· {coin}-PERPETUAL · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FuturesBasisWidget — 期货基差（年化）
// ═══════════════════════════════════════════════════════════════════════════════

export const FuturesBasisWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.basis.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无期货数据</div>
  );

  const { basis } = data;
  const maxBasis = Math.max(...basis.map(b => Math.abs(b.annBasis)), 1);
  const BAR_MAX = 180;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <span className="text-[10px] font-bold text-white/55 uppercase tracking-wider">年化基差（期货 vs 现货）</span>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2">
        {basis.map((b, i) => {
          const barW = (Math.abs(b.annBasis) / maxBasis) * BAR_MAX;
          const color = b.annBasis >= 0 ? 'rgba(37,232,137,0.7)' : 'rgba(248,113,113,0.7)';
          const px = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
          return (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-white/[0.04] last:border-0">
              <div className="w-[72px] shrink-0">
                <div className="text-[11px] font-mono font-semibold text-white/70">{b.label}</div>
                <div className="text-[9px] text-white/55">{b.daysToExp}天 · ${px(b.futurePx)}</div>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-[8px] bg-white/[0.04] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(barW / BAR_MAX) * 100}%`, background: color }}
                  />
                </div>
                <div className="w-[52px] text-right font-mono text-[11px] font-bold shrink-0" style={{ color }}>
                  {b.annBasis >= 0 ? '+' : ''}{b.annBasis.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-2 text-[9px] text-white/55 shrink-0">
        (期货价 / 现货价 − 1) × (365 / 剩余天数) · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// OptionsFlowWidget — 24h Call vs Put 成交量
// ═══════════════════════════════════════════════════════════════════════════════

export const OptionsFlowWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const callVol = data.callVol24h;
  const putVol  = data.putVol24h;
  const total   = callVol + putVol;
  const callPct = total > 0 ? (callVol / total) * 100 : 50;
  const putPct  = 100 - callPct;
  const volRatio = callVol > 0 ? putVol / callVol : 1;

  const fmtVol = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const sentiment = callPct > 55 ? { label: '看涨偏向', color: '#25e889' }
                  : callPct < 45 ? { label: '看跌偏向', color: '#FF5F57' }
                  : { label: '中性', color: '#FEBC2E' };

  // Flow by expiry (top 6)
  const expVol = (data.expiries.slice(0, 6)).map(e => ({
    label: e.label,
    callV: e.calls.reduce((s, o) => s + o.volume, 0),
    putV: e.puts.reduce((s, o) => s + o.volume, 0),
  }));
  const maxExpVol = Math.max(...expVol.map(e => e.callV + e.putV), 1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Totals */}
      <div className="flex gap-2 px-3 pt-2 pb-2 shrink-0">
        {[
          { label: 'Call 成交量', val: fmtVol(callVol), color: '#25e889' },
          { label: 'Put 成交量', val: fmtVol(putVol), color: '#FF5F57' },
          { label: 'P/C 比', val: volRatio.toFixed(2), color: '#FEBC2E' },
          { label: '方向', val: sentiment.label, color: sentiment.color },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Call/Put ratio bar */}
      <div className="px-3 pb-2 shrink-0">
        <div className="flex items-center justify-between text-[9px] text-white/55 mb-1">
          <span>Call {callPct.toFixed(0)}%</span>
          <span>Put {putPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-[6px] rounded-full overflow-hidden bg-white/[0.05]">
          <div className="h-full bg-[#25e889]/70 transition-all" style={{ width: `${callPct}%` }} />
          <div className="h-full bg-[#FF5F57]/70 flex-1" />
        </div>
      </div>

      {/* Per-expiry flow */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <div className="text-[9px] text-white/55 uppercase tracking-wider mb-1.5">按到期日拆分</div>
        {expVol.map((e, i) => {
          const total = e.callV + e.putV;
          const cPct = total > 0 ? (e.callV / total) * 100 : 50;
          const barTotal = (total / maxExpVol) * 100;
          return (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <div className="w-[32px] text-[10px] font-mono text-white/55 shrink-0">{e.label}</div>
              <div className="flex-1 flex h-[12px] rounded-[3px] overflow-hidden bg-white/[0.04]" style={{ maxWidth: `${barTotal}%` }}>
                <div className="h-full bg-[#25e889]/60" style={{ width: `${cPct}%` }} />
                <div className="h-full bg-[#FF5F57]/60 flex-1" />
              </div>
              <div className="text-[9px] text-white/55 font-mono shrink-0 w-[28px] text-right">{fmtVol(total)}</div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/55 shrink-0">
        24H 期权成交量（合约数）· Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FearGreedWidget — 恐慌贪婪指数
// ═══════════════════════════════════════════════════════════════════════════════

const FG_ZONES = [
  { min: 0,  max: 25,  label: '极度恐慌', color: '#FF5F57' },
  { min: 25, max: 45,  label: '恐慌',     color: '#FF8C57' },
  { min: 45, max: 55,  label: '中性',     color: '#FEBC2E' },
  { min: 55, max: 75,  label: '贪婪',     color: '#5DD879' },
  { min: 75, max: 100, label: '极度贪婪', color: '#28C840' },
];
function fgColor(v: number) {
  return FG_ZONES.find(z => v >= z.min && v <= z.max)?.color ?? '#FEBC2E';
}

export const FearGreedWidget = () => {
  const { data, loading } = useFearGreed();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(data ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span> : null);
    return () => setHeaderRight(null);
  }, [setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fearGreed.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>
  );

  const { fearGreed, currentFG, currentFGLabel } = data;
  const vals = fearGreed.map(p => p.value);
  const W = 480, H = 100, PX = 6, PY = 8;
  const lo = 0, hi = 100;
  const pts = mapPts(vals, W, H, lo, hi, PX, PY);
  const color = fgColor(currentFG);

  // Gauge arc (semicircle)
  const GAUGE_R = 44, CX = 56, CY = 64;
  const angle = ((currentFG / 100) * 180 - 180) * (Math.PI / 180);
  const needleX = CX + GAUGE_R * Math.cos(angle);
  const needleY = CY + GAUGE_R * Math.sin(angle);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-stretch gap-2 px-3 pt-2 pb-1 shrink-0">
        {/* Gauge */}
        <div className="shrink-0">
          <svg width={114} height={68} viewBox="0 0 114 68">
            {/* Coloured arc segments */}
            {FG_ZONES.map((z, i) => {
              const startDeg = (z.min / 100) * 180 - 180;
              const endDeg   = (z.max / 100) * 180 - 180;
              const toRad = (d: number) => d * Math.PI / 180;
              const x1 = CX + GAUGE_R * Math.cos(toRad(startDeg));
              const y1 = CY + GAUGE_R * Math.sin(toRad(startDeg));
              const x2 = CX + GAUGE_R * Math.cos(toRad(endDeg));
              const y2 = CY + GAUGE_R * Math.sin(toRad(endDeg));
              const large = endDeg - startDeg > 180 ? 1 : 0;
              return (
                <path key={i}
                  d={`M ${CX} ${CY} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${GAUGE_R} ${GAUGE_R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
                  fill={z.color}
                  opacity={0.25}
                />
              );
            })}
            {/* Arc outline */}
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${CX + GAUGE_R} ${CY}`} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            {/* Needle */}
            <line x1={CX} y1={CY} x2={needleX.toFixed(1)} y2={needleY.toFixed(1)} stroke={color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={CX} cy={CY} r={4} fill={color} />
            {/* Value */}
            <text x={CX} y={CY + 16} textAnchor="middle" fontSize={14} fontWeight={700} fill={color}>{currentFG}</text>
            <text x={CX} y={CY + 26} textAnchor="middle" fontSize={7} fill="rgba(255,255,255,0.35)">{currentFGLabel}</text>
          </svg>
        </div>

        {/* Zone legend */}
        <div className="flex flex-col justify-center gap-0.5 flex-1">
          {FG_ZONES.slice().reverse().map(z => (
            <div key={z.label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: z.color }} />
              <span className="text-[9px] text-white/55">{z.label}</span>
              <span className="text-[9px] text-white/55 ml-auto">{z.min}–{z.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 30D history chart */}
      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* Zone bands */}
          {FG_ZONES.map(z => {
            const yTop = (H - PY) - ((z.max - lo) / (hi - lo)) * (H - 2 * PY);
            const yBot = (H - PY) - ((z.min - lo) / (hi - lo)) * (H - 2 * PY);
            return <rect key={z.label} x={PX} y={yTop} width={W - 2 * PX} height={yBot - yTop} fill={z.color} opacity={0.06} />;
          })}
          {/* Value line */}
          <path d={area(pts, H, PY)} fill={`${fgColor(currentFG)}18`} />
          <polyline points={poly(pts)} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
          {/* X-axis labels: -30D, -15D, today */}
          {[0, Math.floor(vals.length / 2), vals.length - 1].map(idx => {
            const x = PX + (idx / Math.max(vals.length - 1, 1)) * (W - 2 * PX);
            const label = idx === vals.length - 1 ? '今天' : idx === 0 ? '-30天' : '-15天';
            return <text key={idx} x={x} y={H - 1} textAnchor="middle" fontSize={8} fill={TXT}>{label}</text>;
          })}
        </svg>
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/55 shrink-0">
        数据来源：alternative.me · 30天历史
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// BlockTradeWidget — 实时大宗成交流
// ═══════════════════════════════════════════════════════════════════════════════

export const BlockTradeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { trades, loading } = useBlockTrades(coin);
  const { setHeaderRight } = useCardHeader();
  const [minUSD, setMinUSD] = useState(50_000);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {/* Min size filter */}
        <div className="flex gap-0.5">
          {[50_000, 200_000, 500_000].map(v => (
            <button key={v} onClick={() => setMinUSD(v)}
              className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-[5px] transition-colors',
                minUSD === v ? 'bg-white/10 text-white/80' : 'text-white/55 hover:text-white/50'
              )}>
              {v >= 1_000_000 ? `${v/1_000_000}M+` : `${v/1_000}K+`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />10s
        </span>
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, minUSD]);

  const filtered = trades.filter(t => t.notionalUSD >= minUSD);

  const relTime = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };
  const fmtUSD = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header row */}
      <div className="grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['时间', '合约', '方向', 'IV', '规模', '名义金额'].map(h => (
          <span key={h} className="text-[9px] uppercase tracking-[0.06em] text-white/55 font-bold">{h}</span>
        ))}
      </div>

      {loading && filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">等待成交…</div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">暂无达到阈值的大宗成交</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.map((t, i) => {
            const isBuy = t.direction === 'buy';
            const dirColor = isBuy ? '#25e889' : '#FF5F57';
            const typeColor = t.optType === 'C' ? '#4ea1ff' : '#FEBC2E';
            const sizeEmphasis = t.notionalUSD >= 1_000_000;
            return (
              <div
                key={t.tradeId}
                className={cn(
                  'grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-2 border-b border-white/[0.025] transition-colors hover:bg-white/[0.02]',
                  i === 0 && 'bg-white/[0.015]', // highlight newest
                )}
              >
                {/* Time */}
                <span className="font-mono text-[10px] text-white/55">{relTime(t.ts)}</span>
                {/* Instrument */}
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-semibold" style={{ color: typeColor }}>
                    {t.optType}
                  </span>
                  <span className="font-mono text-[10px] text-white/55 ml-1">
                    {t.strike.toLocaleString()} · {t.expiry}
                  </span>
                </div>
                {/* Direction */}
                <span className="font-mono text-[10px] font-bold" style={{ color: dirColor }}>
                  {isBuy ? 'BUY' : 'SELL'}
                </span>
                {/* IV */}
                <span className="font-mono text-[10px] text-white/50 tnum">
                  {t.iv > 0 ? `${t.iv.toFixed(1)}%` : '—'}
                </span>
                {/* Size (contracts) */}
                <span className="font-mono text-[10px] text-white/50 tnum">
                  {t.amount >= 1000 ? `${(t.amount / 1000).toFixed(1)}K` : t.amount.toFixed(1)}
                </span>
                {/* Notional */}
                <span className={cn('font-mono text-[10px] tnum font-bold', sizeEmphasis ? 'text-[var(--nexus-yellow)]' : 'text-white/55')}>
                  {fmtUSD(t.notionalUSD)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        名义金额 = 合约数 × 指数价格 · 仅显示 ≥ {fmtUSD(minUSD)} 的成交 · Deribit
      </div>
    </div>
  );
};

// SkewHistoryWidget removed — session-only, always empty on page load

// ═══════════════════════════════════════════════════════════════════════════════
// VannaCharmWidget — 高阶 Greeks 热力图（Strike × Expiry）
// ═══════════════════════════════════════════════════════════════════════════════

export const VannaCharmWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [mode, setMode] = useState<'vanna' | 'charm'>('vanna');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['vanna', 'charm'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                mode === m ? 'bg-white/10 text-white/80' : 'text-white/55 hover:text-white/50'
              )}>
              {m === 'vanna' ? 'Vanna' : 'Charm'}
            </button>
          ))}
        </div>
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, mode]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  const expiries = pickExpiries(data.expiries, [7, 14, 30, 60, 90]).slice(0, 5);

  // Collect strikes ±15% of spot
  const strikesRaw = new Set<number>();
  expiries.forEach(e => [...e.calls, ...e.puts].forEach(o => {
    if (o.strike >= spot * 0.85 && o.strike <= spot * 1.15) strikesRaw.add(o.strike);
  }));
  const strikes = [...strikesRaw].sort((a, b) => a - b);

  // Build grid: rows=strikes, cols=expiries; value = OI-weighted vanna/charm sum
  const grid: number[][] = strikes.map(k =>
    expiries.map(exp => {
      let total = 0;
      for (const o of [...exp.calls, ...exp.puts]) {
        if (o.strike !== k) continue;
        const g = mode === 'vanna'
          ? bsVanna(spot, k, o.T, o.iv, o.type)
          : bsCharm(spot, k, o.T, o.iv, o.type);
        total += g * o.oi;
      }
      return total;
    })
  );

  const allVals = grid.flat().filter(v => isFinite(v));
  const maxAbs = Math.max(Math.max(...allVals.map(Math.abs)), 1e-9);

  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const fmtVal = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}K`;
    if (abs >= 1)    return v.toFixed(1);
    return v.toFixed(3);
  };

  const CELL_H = 28, CELL_W = 70, LABEL_W = 66;
  const totalW = LABEL_W + expiries.length * CELL_W;
  const totalH = (strikes.length + 1) * CELL_H; // +1 for header

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Description */}
      <div className="px-3 pt-1.5 pb-1 shrink-0">
        <p className="text-[9px] text-white/55 leading-relaxed">
          {mode === 'vanna'
            ? 'Vanna = ∂Δ/∂σ · IV 每涨 1% 时 Delta 的变化 · 做市商 Vanna 对冲会推动行情沿高 Vanna 区加速'
            : 'Charm = ∂Δ/∂t · Delta 每日自然衰减量 · 近到期大 Charm 区是 Pin Risk 来源'}
        </p>
      </div>

      {/* Heatmap */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ display: 'block' }}>
          {/* Column headers */}
          {expiries.map((exp, j) => (
            <text key={exp.label}
              x={LABEL_W + j * CELL_W + CELL_W / 2}
              y={CELL_H / 2 + 4}
              textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)" fontWeight={600}
            >{exp.label}</text>
          ))}

          {/* Row headers + cells */}
          {strikes.map((k, i) => {
            const y = (i + 1) * CELL_H;
            const isSpot = Math.abs(k - spot) / spot < 0.006;
            return (
              <g key={k}>
                {/* Strike label */}
                <text x={LABEL_W - 4} y={y + CELL_H / 2 + 3.5}
                  textAnchor="end" fontSize={9}
                  fill={isSpot ? '#FEBC2E' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isSpot ? 700 : 400}
                >{fmtK(k)}{isSpot ? ' ◆' : ''}</text>

                {/* Cells */}
                {expiries.map((_, j) => {
                  const val = grid[i][j];
                  const bg = heatColor(val, maxAbs);
                  return (
                    <g key={j}>
                      <rect
                        x={LABEL_W + j * CELL_W + 1}
                        y={y + 1}
                        width={CELL_W - 2}
                        height={CELL_H - 2}
                        fill={bg}
                        rx={3}
                      />
                      <text
                        x={LABEL_W + j * CELL_W + CELL_W / 2}
                        y={y + CELL_H / 2 + 3.5}
                        textAnchor="middle"
                        fontSize={8.5}
                        fill={Math.abs(val) / maxAbs > 0.4 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)'}
                        fontWeight={600}
                      >{fmtVal(val)}</text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/55 shrink-0">
        数值 = Σ({mode === 'vanna' ? 'Vanna' : 'Charm'} × OI) · 绿=正 红=负 · ◆现货 · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// IVSignalWidget — 规则信号面板（IV Rank / PCR / Skew / VRP / Funding / TS）
// ═══════════════════════════════════════════════════════════════════════════════

type SignalSeverity = 'bullish' | 'bearish' | 'warning' | 'neutral';

interface IVSignal {
  id: string;
  label: string;
  value: string;
  desc: string;
  severity: SignalSeverity;
}

function severityColor(s: SignalSeverity): string {
  if (s === 'bullish')  return '#25e889';
  if (s === 'bearish')  return '#FF5F57';
  if (s === 'warning')  return '#FEBC2E';
  return 'rgba(255,255,255,0.35)';
}
function severityBg(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.08)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.08)';
  if (s === 'warning')  return 'rgba(245,158,11,0.08)';
  return 'rgba(255,255,255,0.03)';
}
function severityBorder(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.18)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.18)';
  if (s === 'warning')  return 'rgba(245,158,11,0.18)';
  return 'rgba(255,255,255,0.07)';
}

function generateSignals(
  data: DeribitData,
  histData: HistoryData | null,
  flowData: FlowData | null,
): IVSignal[] {
  const signals: IVSignal[] = [];

  // ── 1. IV Rank ────────────────────────────────────────────────────────────
  const ivr = histData?.ivRankCurrent ?? null;
  if (ivr !== null) {
    signals.push({
      id: 'ivrank',
      label: 'IV Rank',
      value: `${ivr.toFixed(0)}%`,
      desc: ivr >= 80 ? '极端高位 — 卖方溢价，考虑卖 IV'
          : ivr >= 60 ? '偏高 — IV 较贵，中性策略占优'
          : ivr <= 20 ? '极端低位 — IV 便宜，考虑买 IV'
          : ivr <= 40 ? '偏低 — IV 较便宜，长 vega 策略有优势'
          : '中性区间',
      severity: ivr >= 75 ? 'bearish' : ivr <= 25 ? 'bullish' : ivr >= 60 ? 'warning' : 'neutral',
    });
  }

  // ── 2. PCR (OI-based) ─────────────────────────────────────────────────────
  const pcr = data.pcr;
  signals.push({
    id: 'pcr',
    label: 'PCR（OI）',
    value: pcr.toFixed(2),
    desc: pcr >= 1.2 ? '看跌 OI 严重堆积 — 市场偏悲观'
        : pcr >= 1.0 ? '看跌稍多 — 轻度偏空情绪'
        : pcr <= 0.6 ? '看涨 OI 过多 — 市场过度乐观'
        : pcr <= 0.8 ? '看涨偏向 — 多头情绪略占优'
        : '多空均衡',
    severity: pcr >= 1.2 ? 'bearish' : pcr <= 0.6 ? 'warning' : pcr >= 1.0 ? 'warning' : 'neutral',
  });

  // ── 3. Skew（30D RR25）────────────────────────────────────────────────────
  const exp30 = data.expiries.length
    ? data.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best,
        data.expiries[0])
    : null;
  if (exp30) {
    const rr25 = exp30.rr25;
    signals.push({
      id: 'skew',
      label: '30D Skew (RR25)',
      value: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(2)}%`,
      desc: rr25 <= -5 ? '强烈看跌偏斜 — 市场积极买入保护'
          : rr25 <= -2 ? '温和看跌偏斜 — 下行保护溢价'
          : rr25 >= 5  ? '强烈看涨偏斜 — 上行 Call 需求旺盛'
          : rr25 >= 2  ? '温和看涨偏斜'
          : '偏斜基本中性',
      severity: rr25 <= -5 ? 'bearish' : rr25 >= 5 ? 'bullish' : rr25 <= -2 ? 'warning' : 'neutral',
    });
  }

  // ── 4. VRP（DVOL − 30D RV）────────────────────────────────────────────────
  if (histData) {
    const vrpPairs = histData.vrp;
    if (vrpPairs.length) {
      const latest = vrpPairs[vrpPairs.length - 1];
      const vrp = latest.iv - latest.rv;
      signals.push({
        id: 'vrp',
        label: 'VRP (IV−RV)',
        value: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}pp`,
        desc: vrp >= 12 ? '波动率风险溢价极高 — 卖方历史上有稳定收益'
            : vrp >= 6  ? 'VRP 偏高 — 期权定价偏贵'
            : vrp <= 0  ? 'VRP 为负 — 已实现波动超过隐含波动，少见'
            : vrp <= 2  ? 'VRP 受压 — 期权相对便宜'
            : 'VRP 正常区间',
        severity: vrp >= 12 ? 'bearish' : vrp <= 0 ? 'bullish' : vrp <= 2 ? 'warning' : 'neutral',
      });
    }
  }

  // ── 5. Funding Rate（年化）────────────────────────────────────────────────
  if (flowData) {
    const annFunding = flowData.annFunding;
    signals.push({
      id: 'funding',
      label: '资金费率（年化）',
      value: `${annFunding >= 0 ? '+' : ''}${annFunding.toFixed(1)}%`,
      desc: annFunding >= 50 ? '永续多头极度拥挤 — 回调风险高'
          : annFunding >= 25 ? '资金费率偏高 — 多头主导，注意过热'
          : annFunding <= -15? '永续空头拥挤 — 轧空风险'
          : annFunding <= -5 ? '资金费率偏低 — 市场偏空情绪'
          : '资金费率中性',
      severity: annFunding >= 50 ? 'bearish' : annFunding <= -15 ? 'bullish'
              : annFunding >= 25 ? 'warning' : annFunding <= -5 ? 'warning' : 'neutral',
    });
  }

  // ── 6. Term Structure（前端 vs 后端 IV）──────────────────────────────────
  if (data.expiries.length >= 2) {
    const front = data.expiries[0];
    const back  = data.expiries[data.expiries.length - 1];
    const slope = back.atmIV - front.atmIV;
    signals.push({
      id: 'termstructure',
      label: '期限结构',
      value: `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}pp`,
      desc: slope <= -8 ? '强倒挂 — 近端 IV 极度拥挤，事件驱动风险高'
          : slope <= -3 ? '轻度倒挂 — 近端 IV 抬升，市场情绪偏紧张'
          : slope >= 8  ? '显著正斜 — 远端溢价高，日历价差受益'
          : slope >= 3  ? '正常正斜 — 结构健康'
          : '平坦期限结构',
      severity: slope <= -8 ? 'bearish' : slope <= -3 ? 'warning'
              : slope >= 8  ? 'bullish' : 'neutral',
    });
  }

  return signals;
}

export const IVSignalWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading }    = useDeribitOptions(coin);
  const { data: histData }   = useDeribitHistory(coin);
  const { data: flowData }   = useFlowData(coin);
  const { setHeaderRight }   = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/55">暂无信号数据</div>;

  const signals = generateSignals(data, histData, flowData);

  return (
    <div className="w-full h-full flex items-stretch gap-2 px-3 py-2 overflow-x-auto min-w-0">
      {signals.map(sig => (
        <div
          key={sig.id}
          className="flex-1 min-w-[120px] flex flex-col justify-between rounded-[10px] border px-3 py-2 shrink-0"
          style={{
            background: severityBg(sig.severity),
            borderColor: severityBorder(sig.severity),
          }}
        >
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55 truncate">{sig.label}</span>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: severityColor(sig.severity), boxShadow: `0 0 5px ${severityColor(sig.severity)}88` }}
            />
          </div>
          <div className="font-mono text-[15px] font-bold leading-none mb-1.5" style={{ color: severityColor(sig.severity) }}>
            {sig.value}
          </div>
          <div className="text-[9px] text-white/55 leading-snug line-clamp-2">{sig.desc}</div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ExpiryCalendarWidget — 到期日 OI 日历（每档到期 Call/Put OI 堆叠 + max pain）
// ═══════════════════════════════════════════════════════════════════════════════

/** Compute max-pain strike: strike with minimum total dollar loss for option writers */
function maxPain(exp: ExpiryGroup, spot: number): number {
  const strikes = [...new Set([...exp.calls, ...exp.puts].map(o => o.strike))].sort((a, b) => a - b);
  if (!strikes.length) return spot;

  let minPain = Infinity;
  let mpStrike = strikes[0];

  for (const s of strikes) {
    // Total loss to writers if underlying expires at s
    const callLoss = exp.calls.reduce((sum, o) => sum + o.oi * Math.max(0, s - o.strike), 0);
    const putLoss  = exp.puts.reduce((sum, o)  => sum + o.oi * Math.max(0, o.strike - s), 0);
    const pain = callLoss + putLoss;
    if (pain < minPain) { minPain = pain; mpStrike = s; }
  }
  return mpStrike;
}

export const ExpiryCalendarWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  // maxPain is O(strikes²) per expiry — memoised so it only runs when data changes (every 90s).
  const calRows = useMemo(() => {
    if (!data || !data.expiries.length) return null;
    const spot = data.spot;
    return data.expiries.slice(0, 10).map(e => {
      const callOI = e.calls.reduce((s, o) => s + o.oi, 0);
      const putOI  = e.puts.reduce((s,  o) => s + o.oi, 0);
      const totalOI = callOI + putOI;
      const pcr = callOI > 0 ? putOI / callOI : 1;
      const mp = maxPain(e, spot);
      const mpPct = spot > 0 ? ((mp - spot) / spot) * 100 : 0;
      return { label: e.label, daysToExp: e.daysToExp, callOI, putOI, totalOI, pcr, atmIV: e.atmIV, mp, mpPct };
    });
  }, [data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.expiries.length || !calRows) return <div className="p-3 text-[11px] text-white/55">暂无到期日数据</div>;

  const rows = calRows;
  const maxOI = Math.max(...rows.map(r => r.totalOI), 1);
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const BAR_MAX = 220; // max bar width in px
  const ROW_H = 38;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Column headers */}
      <div className="grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期日', 'OI 分布（Call ▶ ◀ Put）', 'PCR', 'ATM IV', 'Max Pain', '偏离现货'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((r, i) => {
          const callBarW = maxOI > 0 ? (r.callOI / maxOI) * (BAR_MAX / 2) : 0;
          const putBarW  = maxOI > 0 ? (r.putOI  / maxOI) * (BAR_MAX / 2) : 0;
          const pcrColor2 = r.pcr >= 1.2 ? '#FF5F57' : r.pcr <= 0.7 ? '#25e889' : '#FEBC2E';
          const mpColor   = r.mpPct >= 3 ? '#25e889' : r.mpPct <= -3 ? '#FF5F57' : 'rgba(255,255,255,0.4)';
          const isNear    = r.daysToExp <= 7;

          return (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 items-center border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors',
                isNear && 'bg-[var(--nexus-yellow)]/[0.04]',
              )}
              style={{ minHeight: ROW_H }}
            >
              {/* Label */}
              <div>
                <div className={cn('text-[11px] font-mono font-bold', isNear ? 'text-[var(--nexus-yellow)]' : 'text-white/60')}>{r.label}</div>
                <div className="text-[9px] text-white/55">{r.daysToExp}天</div>
              </div>

              {/* OI bar (call left, put right, centre-aligned) */}
              <div className="flex items-center justify-center gap-px">
                {/* Call bar (grows left) */}
                <div className="flex justify-end" style={{ width: `${BAR_MAX / 2}px` }}>
                  <div
                    className="h-[10px] rounded-l-[3px] transition-all"
                    style={{ width: `${callBarW}px`, background: 'rgba(37,232,137,0.55)' }}
                  />
                </div>
                {/* Centre spine */}
                <div className="w-px h-[12px] bg-white/10" />
                {/* Put bar (grows right) */}
                <div className="flex justify-start" style={{ width: `${BAR_MAX / 2}px` }}>
                  <div
                    className="h-[10px] rounded-r-[3px] transition-all"
                    style={{ width: `${putBarW}px`, background: 'rgba(248,113,113,0.55)' }}
                  />
                </div>
              </div>

              {/* PCR */}
              <span className="font-mono text-[11px] font-bold" style={{ color: pcrColor2 }}>
                {r.pcr.toFixed(2)}
              </span>

              {/* ATM IV */}
              <span className="font-mono text-[11px] text-white/50">
                {r.atmIV.toFixed(1)}%
              </span>

              {/* Max Pain price */}
              <span className="font-mono text-[11px] text-white/55">
                ${fmtPx(r.mp)}
              </span>

              {/* MP vs spot */}
              <span className="font-mono text-[11px] font-bold" style={{ color: mpColor }}>
                {r.mpPct >= 0 ? '+' : ''}{r.mpPct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-3 py-1.5 shrink-0 border-t border-white/[0.04] flex items-center gap-4">
        <span className="text-[9px] text-white/55">
          Max Pain = 期权卖方总损失最小的到期价
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(37,232,137,0.55)]" />
            <span className="text-[9px] text-white/55">Call OI</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(248,113,113,0.55)]" />
            <span className="text-[9px] text-white/55">Put OI</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DEXWidget — Dealer Delta Exposure by Strike
// ═══════════════════════════════════════════════════════════════════════════════
//
// DEX(K) = (|putDelta| × putOI − callDelta × callOI) × spot
//
// Positive  → dealers net long delta → they sell as price rises (resistance)
// Negative  → dealers net short delta → they buy as price rises (support/acceleration)

export const DEXWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  const BIN = spot > 10_000 ? 1_000 : 100;

  // Collect all options ±20% of spot
  const allOpts = data.expiries.flatMap(e => [...e.calls, ...e.puts]);
  const inRange  = allOpts.filter(o => o.strike >= spot * 0.80 && o.strike <= spot * 1.20);

  // Bin by rounded strike
  const bins = new Map<number, number>(); // strike → DEX value
  for (const o of inRange) {
    const k = Math.round(o.strike / BIN) * BIN;
    const delta = Math.abs(o.delta); // use abs for both call/put
    const sign  = o.type === 'C' ? -1 : 1; // dealer short call = -delta; dealer short put = +|putDelta|
    const contrib = sign * delta * o.oi * spot / 1_000_000; // in $M
    bins.set(k, (bins.get(k) ?? 0) + contrib);
  }

  const sorted = [...bins.entries()].sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return <div className="p-4 text-[11px] text-white/55">数据不足</div>;

  const maxAbs = Math.max(...sorted.map(([, v]) => Math.abs(v)), 0.01);
  const BAR_MAX = 110; // half-width in px
  const ROW_H = 22;
  const fmtM = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1000) return `${(v / 1000).toFixed(1)}B`;
    if (a >= 1)    return `${v.toFixed(1)}M`;
    return `${(v * 1000).toFixed(0)}K`;
  };
  const fmtK2 = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  // Net total DEX
  const netDEX = sorted.reduce((s, [, v]) => s + v, 0);
  const netColor = netDEX < 0 ? '#25e889' : '#FF5F57';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Summary */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">净 DEX</div>
          <div className="font-mono text-[13px] font-bold" style={{ color: netColor }}>
            {netDEX >= 0 ? '+' : ''}{fmtM(netDEX)}
          </div>
        </div>
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">方向</div>
          <div className="font-mono text-[12px] font-bold" style={{ color: netColor }}>
            {netDEX < 0 ? '做市商净空 → 助涨' : '做市商净多 → 阻涨'}
          </div>
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
        {sorted.map(([strike, dex]) => {
          const isSpot = Math.abs(strike - spot) / spot < (BIN / spot) * 0.6;
          const isPos  = dex >= 0;
          const barW   = (Math.abs(dex) / maxAbs) * BAR_MAX;
          const color  = isPos ? '#FF5F57' : '#25e889'; // red=resistance / green=support
          return (
            <div
              key={strike}
              className={cn('flex items-center gap-1 border-b border-white/[0.025]', isSpot && 'bg-[var(--nexus-yellow)]/[0.06]')}
              style={{ height: ROW_H }}
            >
              {/* Strike label */}
              <div className="w-[58px] shrink-0 text-right pr-1">
                <span className={cn('font-mono text-[9.5px]', isSpot ? 'text-[var(--nexus-yellow)] font-bold' : 'text-white/55')}>
                  {fmtK2(strike)}{isSpot ? '◆' : ''}
                </span>
              </div>

              {/* Centre spine + bars */}
              <div className="flex items-center" style={{ width: BAR_MAX * 2 + 2 }}>
                {/* Negative bar (green, left side) */}
                <div className="flex justify-end" style={{ width: BAR_MAX }}>
                  {!isPos && (
                    <div className="h-[8px] rounded-l-[2px]" style={{ width: barW, background: color }} />
                  )}
                </div>
                <div className="w-px h-[10px] bg-white/10 shrink-0" />
                {/* Positive bar (red, right side) */}
                <div className="flex justify-start" style={{ width: BAR_MAX }}>
                  {isPos && (
                    <div className="h-[8px] rounded-r-[2px]" style={{ width: barW, background: color }} />
                  )}
                </div>
              </div>

              {/* Value */}
              <div className="w-[52px] shrink-0 text-right font-mono text-[9px] font-bold" style={{ color }}>
                {dex >= 0 ? '+' : ''}{fmtM(dex)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/55 shrink-0">
        绿=做市商净空δ（买盘支撑） 红=净多δ（卖压阻力） 单位$M · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// KeyLevelsWidget — 关键价位一览（Gamma Flip · Max Pain · 最大OI行权价 · 现货）
// ═══════════════════════════════════════════════════════════════════════════════

export const KeyLevelsWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  const BIN  = spot > 10_000 ? 1_000 : 100;

  // ── GEX per strike → find gamma flip ─────────────────────────────────────
  const allOpts = data.expiries.flatMap(e => [...e.calls, ...e.puts]);
  const gexBins = new Map<number, number>();
  for (const o of allOpts.filter(o => o.strike >= spot * 0.70 && o.strike <= spot * 1.30)) {
    const k = Math.round(o.strike / BIN) * BIN;
    const g = bsGamma(spot, o.strike, o.T, o.iv) * o.oi * spot * spot / 100;
    // put gamma reduces dealer gamma when puts are bought: put buyers → dealer short puts → positive gamma to dealers
    // call buyers → dealer short calls → positive gamma to dealers
    // so both add to dealer gamma. GEX = Σ gamma × OI × S² / 100
    const sign = o.type === 'C' ? 1 : -1; // calls add positive dealer gamma, puts (when bought) reduce it at strikes below spot
    gexBins.set(k, (gexBins.get(k) ?? 0) + sign * g);
  }
  const gexSorted = [...gexBins.entries()].sort((a, b) => a[0] - b[0]);

  // Gamma flip: strike where per-strike GEX changes sign going downward from spot
  // More practically: the strike where GEX transitions from + to - below spot (support flip)
  let gammaFlip: number | null = null;
  // Look below spot for where GEX first goes negative
  const belowSpot = gexSorted.filter(([k]) => k <= spot).reverse();
  for (let i = 0; i < belowSpot.length - 1; i++) {
    if (belowSpot[i][1] >= 0 && belowSpot[i + 1][1] < 0) {
      gammaFlip = belowSpot[i][0];
      break;
    }
    if (belowSpot[i][1] < 0) {
      gammaFlip = belowSpot[i][0];
      break;
    }
  }
  if (!gammaFlip && gexSorted.length) {
    // fallback: strike with lowest GEX value below spot
    const neg = gexSorted.filter(([k, v]) => k <= spot && v < 0);
    gammaFlip = neg.length ? neg.reduce((b, c) => c[1] < b[1] ? c : b, neg[0])[0] : null;
  }

  // ── Biggest OI strike (total call + put OI) ────────────────────────────────
  const oiBins = new Map<number, number>();
  for (const o of allOpts.filter(o => o.strike >= spot * 0.70 && o.strike <= spot * 1.30)) {
    const k = Math.round(o.strike / BIN) * BIN;
    oiBins.set(k, (oiBins.get(k) ?? 0) + o.oi);
  }
  const biggestOI = [...oiBins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? spot;

  // ── Max Pain (nearest expiry) ──────────────────────────────────────────────
  const nearestExp = data.expiries[0] ?? null;
  const mpPrice = nearestExp ? maxPain(nearestExp, spot) : null;

  // ── Build levels array ─────────────────────────────────────────────────────
  const fmtPx2 = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const pctFromSpot = (v: number) => {
    const p = ((v - spot) / spot) * 100;
    return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
  };

  const levels: { label: string; price: number; color: string; desc: string }[] = [
    { label: '现货', price: spot, color: '#FEBC2E', desc: '当前指数价格' },
    ...(gammaFlip ? [{ label: 'Gamma Flip', price: gammaFlip, color: gammaFlip < spot ? '#FF5F57' : '#25e889', desc: gammaFlip < spot ? '跌破此位 → 负 Gamma 区' : '站上此位 → 正 Gamma 区' }] : []),
    ...(mpPrice !== null ? [{ label: `Max Pain (${nearestExp!.label})`, price: mpPrice, color: '#a78bfa', desc: '期权卖方总损失最小到期价' }] : []),
    { label: '最大 OI 行权价', price: biggestOI, color: '#4ea1ff', desc: '全部到期日合并最大持仓量行权价' },
  ].sort((a, b) => a.price - b.price); // ascending = leftmost card matches leftmost dot on ruler

  // Price ruler: map levels onto a horizontal bar
  const allPrices = levels.map(l => l.price);
  const minP = Math.min(...allPrices) * 0.993;
  const maxP = Math.max(...allPrices) * 1.007;
  const rangeP = maxP - minP || 1;
  const toX = (p: number) => ((p - minP) / rangeP) * 100; // 0–100 %

  return (
    <div className="w-full h-full flex flex-col px-4 pt-2 pb-1 gap-2">
      {/* ── Level cards ──────────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 flex-1 min-h-0">
        {levels.map(lv => (
          <div
            key={lv.label}
            className="flex-1 min-w-[100px] rounded-[8px] border px-2.5 py-1.5 flex flex-col justify-between"
            style={{ borderColor: `${lv.color}28`, background: `${lv.color}09` }}
          >
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] truncate">{lv.label}</div>
            <div className="font-mono text-[14px] font-bold leading-tight" style={{ color: lv.color }}>
              ${fmtPx2(lv.price)}
            </div>
            <div className="flex items-end justify-between gap-1">
              <span className="text-[8.5px] text-white/55 leading-snug truncate">{lv.desc}</span>
              {lv.label !== '现货' && (
                <span className="font-mono text-[9px] shrink-0 font-bold"
                  style={{ color: lv.price >= spot ? '#25e889' : '#FF5F57' }}>
                  {pctFromSpot(lv.price)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── SVG price ruler (dots hang DOWN from baseline) ───────────────── */}
      <div className="shrink-0 w-full" style={{ height: 22 }}>
        <svg viewBox="0 0 1000 22" preserveAspectRatio="none" width="100%" height="22">
          {/* baseline */}
          <line x1="0" y1="4" x2="1000" y2="4" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          {levels.map(lv => {
            const x = toX(lv.price) * 10; // viewBox is 0–1000
            return (
              <g key={lv.label}>
                {/* tick from baseline downward */}
                <line x1={x} y1="4" x2={x} y2="13"
                  stroke={lv.color} strokeWidth="1.2" />
                {/* dot at bottom of tick */}
                <circle cx={x} cy="18" r="3.5" fill={lv.color}
                  style={{ filter: `drop-shadow(0 0 3px ${lv.color}88)` }} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// PCRHistoryWidget removed — session-only, always empty on page load

// ═══════════════════════════════════════════════════════════════════════════════
// ImpliedMoveWidget — 隐含波动区间（每个到期日 ATM straddle 隐含涨跌幅）
// ═══════════════════════════════════════════════════════════════════════════════
//
// Implied Move ≈ atmIV × √T × √(2/π)  (ATM straddle 近似)
// Shows the ±% range the market "prices in" for each upcoming expiry.

export const ImpliedMoveWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/55">暂无数据</div>;

  // Use up to 8 expiries
  const exps = data.expiries.slice(0, 8);
  const SQRT_2_PI = Math.sqrt(2 / Math.PI); // ≈ 0.7979

  const rows = exps.map(e => {
    const movePct = (e.atmIV / 100) * Math.sqrt(e.T) * SQRT_2_PI * 100;
    const upTarget   = data.spot * (1 + movePct / 100);
    const downTarget = data.spot * (1 - movePct / 100);
    return { label: e.label, movePct, atmIV: e.atmIV, upTarget, downTarget, daysToExp: e.daysToExp };
  });

  const maxMove = Math.max(...rows.map(r => r.movePct), 1);
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  return (
    <div className="w-full h-full flex items-stretch gap-1.5 px-3 py-2 overflow-x-auto">
      {rows.map(r => {
        const barFill = (r.movePct / maxMove) * 100;
        const urgency = r.daysToExp <= 7 ? '#FEBC2E' : r.daysToExp <= 30 ? '#25e889' : '#4ea1ff';
        return (
          <div key={r.label}
            className="flex-1 min-w-[96px] flex flex-col justify-between bg-white/[0.025] border border-white/[0.06] rounded-[10px] px-2.5 py-2 shrink-0"
          >
            {/* Tenor label + IV */}
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] font-bold" style={{ color: urgency }}>{r.label}</span>
              <span className="text-[9px] text-white/55 font-mono">{r.atmIV.toFixed(1)}%</span>
            </div>

            {/* Move % — the headline number */}
            <div className="font-mono text-[17px] font-bold leading-none mb-1" style={{ color: urgency }}>
              ±{r.movePct.toFixed(1)}%
            </div>

            {/* Up / down targets */}
            <div className="flex justify-between text-[8.5px] font-mono mb-1.5">
              <span style={{ color: '#25e889' }}>↑${fmtPx(r.upTarget)}</span>
              <span style={{ color: '#FF5F57' }}>↓${fmtPx(r.downTarget)}</span>
            </div>

            {/* Bar proportional to move size */}
            <div className="h-[3px] rounded-full overflow-hidden bg-white/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${barFill}%`, background: urgency, opacity: 0.7 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DollarGreeksWidget — 市场聚合 Dollar Greeks 面板
// ═══════════════════════════════════════════════════════════════════════════════
//
// Sums all open-interest-weighted Greeks across every option, expressed in $.
// Net $Δ  — directional bias of the entire options market in $
// $Vega   — $ gain/loss per 1% IV rise (all OI combined)
// $Θ/day  — total daily theta decay burning through the market
// $Γ/1%   — $ gamma flip exposure per 1% spot move

export const DollarGreeksWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  const allOpts = data.expiries.flatMap(e => [...e.calls, ...e.puts]);

  let netDollarDelta = 0;  // $
  let dollarVega     = 0;  // $ per 1% IV
  let dollarTheta    = 0;  // $ per day (negative)
  let dollarGamma    = 0;  // $ per 1% spot move

  for (const o of allOpts) {
    if (o.oi <= 0 || o.T <= 0) continue;
    const S = spot, K = o.strike, T = o.T, iv = o.iv;

    // Dollar Delta: delta × OI × spot (1 contract = 1 coin)
    netDollarDelta += o.delta * o.oi * spot;

    // Dollar Vega: vega per contract × OI (vega already per 1% IV)
    dollarVega += bsVega(S, K, T, iv) * o.oi;

    // Dollar Theta: theta per contract ($ per day) × OI
    dollarTheta += bsTheta(S, K, T, iv) * o.oi;

    // Dollar Gamma: gamma × OI × spot² / 100 ($ per 1% spot)
    dollarGamma += bsGamma(S, K, T, iv) * o.oi * spot * spot / 100;
  }

  const fmtM = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };
  const sign = (v: number) => v >= 0 ? '+' : '';

  const stats = [
    {
      label: 'Net $Δ',
      val: `${sign(netDollarDelta)}${fmtM(netDollarDelta)}`,
      sub: netDollarDelta > 0 ? '市场净多头' : '市场净空头',
      color: netDollarDelta >= 0 ? '#25e889' : '#FF5F57',
      tip: 'OI加权净Delta，>0市场整体偏多',
    },
    {
      label: '$Vega / 1% IV',
      val: `${sign(dollarVega)}${fmtM(dollarVega)}`,
      sub: '全市场 IV 涨 1% 的盈亏',
      color: '#4ea1ff',
      tip: '隐含波动率每涨1%全体OI的价值变化',
    },
    {
      label: '$Θ / 天',
      val: `${fmtM(dollarTheta)}`,
      sub: '每日时间价值消耗',
      color: '#FF5F57',
      tip: '每过一个自然日市场OI总时间价值衰减',
    },
    {
      label: '$Γ / 1% 现货',
      val: `${sign(dollarGamma)}${fmtM(dollarGamma)}`,
      sub: dollarGamma >= 0 ? '正Gamma — 稳定' : '负Gamma — 加速',
      color: dollarGamma >= 0 ? '#25e889' : '#FEBC2E',
      tip: '现货每涨1%时Delta变化引起的美元敞口',
    },
  ];

  return (
    <div className="w-full h-full flex items-stretch gap-2 px-3 py-2">
      {stats.map(s => (
        <div key={s.label}
          className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[10px] px-3 py-2 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{s.label}</span>
          </div>
          <div className="font-mono text-[15px] font-bold leading-tight" style={{ color: s.color }}>
            {s.val}
          </div>
          <div className="text-[9px] text-white/55 mt-0.5 leading-snug">{s.sub}</div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// RVvsIVTenorWidget — 各期限 RV vs IV 对比（找哪段 vol 便宜/贵）
// ═══════════════════════════════════════════════════════════════════════════════

const RV_IV_TENORS = [7, 14, 30, 60, 90, 180] as const;

export const RVvsIVTenorWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }                    = useDeribitOptions(coin);
  const { data: hist, timedOut }    = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && hist && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, hist]);

  if (!data || !hist) return timedOut ? <HistLoadErr /> : <Skeleton />;

  // Current IV: for each tenor find nearest expiry in data.expiries
  const currentIV: number[] = RV_IV_TENORS.map(t => {
    if (!data.expiries.length) return 0;
    const nearest = data.expiries.reduce((best, e) =>
      Math.abs(e.daysToExp - t) < Math.abs(best.daysToExp - t) ? e : best,
      data.expiries[0]
    );
    return nearest.atmIV;
  });

  // Current RV from hist.rvByTenor — tenors are [7,14,30,60,90,180,365]
  // hist.rvByTenor index 0→7D, 1→14D, 2→30D, 3→60D, 4→90D, 5→180D, 6→365D
  const RV_HIST_TENORS = [7, 14, 30, 60, 90, 180, 365];
  const currentRV: number[] = RV_IV_TENORS.map(t => {
    const idx = RV_HIST_TENORS.indexOf(t);
    return idx >= 0 ? (hist.rvByTenor[idx] ?? 0) : 0;
  });

  const labels = RV_IV_TENORS.map(t => `${t}D`);
  const vrpByTenor = currentIV.map((iv, i) => iv - currentRV[i]);

  const allVals = [...currentIV, ...currentRV].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;

  const W = 520, H = 160, PX = 32, PY = 14;
  const lo = Math.floor(Math.min(...allVals) * 0.9 / 5) * 5;
  const hi = Math.ceil(Math.max(...allVals) * 1.1 / 5) * 5;
  const n = labels.length;

  const BAR_W = (W - 2 * PX) / n;
  const HALF = BAR_W * 0.28;

  const fy = (v: number) => (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);

  // Grid lines
  const gridVals = Array.from({ length: 5 }, (_, i) => lo + (i * (hi - lo)) / 4);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* VRP pills */}
      <div className="flex gap-1.5 px-3 pt-2 pb-1 shrink-0 flex-wrap">
        {labels.map((lbl, i) => {
          const vrp = vrpByTenor[i];
          const col = vrp >= 8 ? '#FF5F57' : vrp >= 3 ? '#FEBC2E' : vrp <= 0 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div key={lbl} className="flex items-center gap-1 bg-white/[0.02] border border-white/[0.06] rounded-[6px] px-2 py-0.5">
              <span className="text-[9px] text-white/55">{lbl}</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: col }}>
                VRP {vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bar chart */}
      <div className="flex-1 min-h-0 px-3 pb-1">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* Grid */}
          {gridVals.map(v => (
            <g key={v}>
              <line x1={PX} y1={fy(v)} x2={W - PX} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
              <text x={PX - 3} y={fy(v) + 3.5} textAnchor="end" fontSize={8} fill={TXT}>{v.toFixed(0)}</text>
            </g>
          ))}

          {/* Bars */}
          {labels.map((lbl, i) => {
            const cx = PX + (i + 0.5) * BAR_W;
            const ivY  = fy(currentIV[i]);
            const rvY  = fy(currentRV[i]);
            const botY = fy(lo);
            const ivH  = Math.max(botY - ivY, 1);
            const rvH  = Math.max(botY - rvY, 1);
            return (
              <g key={lbl}>
                {/* RV bar (dashed, blue) */}
                <rect x={cx - HALF * 1.9} y={rvY} width={HALF} height={rvH}
                  fill={BLUE} opacity={0.5} rx={2} />
                {/* IV bar (solid, green) */}
                <rect x={cx - HALF * 0.1} y={ivY} width={HALF} height={ivH}
                  fill={BRAND} opacity={0.7} rx={2} />
                {/* X label */}
                <text x={cx} y={H - 2} textAnchor="middle" fontSize={8} fill={TXT}>{lbl}</text>
                {/* IV value above bar */}
                <text x={cx - HALF * 0.1 + HALF / 2} y={ivY - 2} textAnchor="middle" fontSize={7} fill={BRAND}>
                  {currentIV[i].toFixed(0)}
                </text>
                {/* RV value above bar */}
                <text x={cx - HALF * 1.9 + HALF / 2} y={rvY - 2} textAnchor="middle" fontSize={7} fill={BLUE}>
                  {currentRV[i].toFixed(0)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 pb-2 shrink-0">
        {[{ c: BRAND, l: '隐含波动率 IV（当前）' }, { c: BLUE, l: '已实现波动率 RV（历史）' }].map(({ c, l }) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-[2px]" style={{ background: c, opacity: 0.7 }} />
            <span className="text-[9px] text-white/55">{l}</span>
          </div>
        ))}
        <span className="ml-auto text-[9px] text-white/55">VRP = IV − RV · &gt;8pp 贵 · &lt;0 便宜</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TopOIWidget — 最大持仓合约 Top 15
// ═══════════════════════════════════════════════════════════════════════════════

export const TopOIWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [sortBy, setSortBy] = useState<'oi' | 'vol'>('oi');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['oi', 'vol'] as const).map(m => (
            <button key={m} onClick={() => setSortBy(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                sortBy === m ? 'bg-white/10 text-white/80' : 'text-white/55 hover:text-white/50'
              )}>
              {m === 'oi' ? '持仓量' : '成交量'}
            </button>
          ))}
        </div>
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, sortBy]);

  // Memoised: flatMap + sort of the full option chain, keyed on data + sortBy.
  const { spot, sorted, maxVal } = useMemo(() => {
    if (!data) return { spot: 0, sorted: [], maxVal: 1 };
    const sp = data.spot;
    const all = data.expiries.flatMap(e =>
      [...e.calls, ...e.puts].map(o => ({ ...o, expLabel: e.label }))
    );
    const s = [...all].sort((a, b) => sortBy === 'oi' ? b.oi - a.oi : b.volume - a.volume).slice(0, 15);
    return { spot: sp, sorted: s, maxVal: Math.max(...s.map(o => sortBy === 'oi' ? o.oi : o.volume), 1) };
  }, [data, sortBy]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  const fmtN = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const moneyness = (o: ParsedOption) => {
    const pct = ((o.strike - spot) / spot) * 100;
    if (Math.abs(pct) < 1) return { label: 'ATM', color: '#FEBC2E' };
    if (pct > 0) return { label: `OTM +${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
    return { label: `OTM ${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="grid grid-cols-[40px_60px_56px_48px_56px_56px_1fr] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['#', '行权价', '到期', '类型', 'IV', 'Delta', sortBy === 'oi' ? '持仓量 OI' : '成交量 Vol'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map((o, i) => {
          const val = sortBy === 'oi' ? o.oi : o.volume;
          const barW = (val / maxVal) * 100;
          const typeColor = o.type === 'C' ? '#4ea1ff' : '#FEBC2E';
          const m = moneyness(o);
          return (
            <div key={i}
              className="grid grid-cols-[40px_60px_56px_48px_56px_56px_1fr] gap-x-2 px-3 py-1.5 border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors items-center"
            >
              <span className="text-[10px] text-white/55 font-mono">{i + 1}</span>
              <div>
                <span className="font-mono text-[11px] font-bold text-white/75">${fmtK(o.strike)}</span>
                <div className="text-[8.5px] mt-0.5" style={{ color: m.color }}>{m.label}</div>
              </div>
              <span className="font-mono text-[10px] text-white/55">{o.expLabel}</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: typeColor }}>
                {o.type === 'C' ? 'CALL' : 'PUT'}
              </span>
              <span className="font-mono text-[10px] text-white/50">{o.iv.toFixed(1)}%</span>
              <span className="font-mono text-[10px] text-white/55">{o.delta.toFixed(2)}</span>

              {/* Bar + value */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/[0.04]">
                  <div className="h-full rounded-full" style={{ width: `${barW}%`, background: typeColor, opacity: 0.6 }} />
                </div>
                <span className="font-mono text-[10px] text-white/50 shrink-0 w-[36px] text-right">{fmtN(val)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        按{sortBy === 'oi' ? '持仓量' : '成交量'}排序 · 全到期日 · Deribit
      </div>
    </div>
  );
};

// TermStructureDriftWidget removed — session-only, always empty on page load

// ═══════════════════════════════════════════════════════════════════════════════
// StrategyPricerWidget — ATM Straddle / 25δ Strangle 快速定价
// ═══════════════════════════════════════════════════════════════════════════════

export const StrategyPricerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.expiries.length) return <div className="p-3 text-[11px] text-white/55">暂无数据</div>;

  const spot = data.spot;
  // Use up to 4 near-dated expiries
  const exps = data.expiries.slice(0, 4);

  const fmtPct = (v: number) => `${v >= 0 ? '' : ''}${v.toFixed(2)}%`;
  const fmtUSD = (v: number) => {
    if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(0)}`;
  };

  const rows = exps.map(e => {
    const { calls, puts, atmIV, rr25, T, daysToExp, label } = e;

    // ATM straddle: 2× ATM call (since ATM call = ATM put when r=q=0)
    const straddlePerCoin = 2 * bsCall(spot, spot, T, atmIV);
    const straddlePct     = (straddlePerCoin / spot) * 100;
    const straddleUSD     = straddlePerCoin * spot; // dollar notional per contract (1 contract = 1 coin)
    const upBE   = spot * (1 + straddlePct / 100);
    const downBE = spot * (1 - straddlePct / 100);

    // 25D strangle: call closest to 0.25 delta + put closest to 0.25 delta (abs)
    const call25 = calls.reduce((best, o) =>
      Math.abs(o.delta - 0.25) < Math.abs(best.delta - 0.25) ? o : best, calls[0]);
    const put25  = puts.reduce((best, o) =>
      Math.abs(Math.abs(o.delta) - 0.25) < Math.abs(Math.abs(best.delta) - 0.25) ? o : best, puts[0]);

    const stranglePct = call25 && put25
      ? ((bsCall(spot, call25.strike, T, call25.iv) + bsPut(spot, put25.strike, T, put25.iv)) / spot) * 100
      : null;

    // Strangle width (distance between the two wings as % of spot)
    const strangleWidth = call25 && put25
      ? ((call25.strike - put25.strike) / spot) * 100
      : null;

    return { label, daysToExp, straddlePct, straddleUSD, upBE, downBE, stranglePct, strangleWidth, rr25, atmIV };
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Column headers */}
      <div className="grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期', 'ATM IV', 'Straddle', '上行 BE', '下行 BE', '25δ Strangle', 'RR25'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((r, i) => {
          const isNear = r.daysToExp <= 7;
          const rrColor = r.rr25 < -3 ? '#FF5F57' : r.rr25 > 3 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-2.5 border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors items-center',
                isNear && 'bg-[var(--nexus-yellow)]/[0.03]',
              )}
            >
              {/* Expiry label */}
              <div>
                <div className={cn('font-mono text-[11px] font-bold', isNear ? 'text-[var(--nexus-yellow)]' : 'text-white/60')}>
                  {r.label}
                </div>
                <div className="text-[8.5px] text-white/55">{r.daysToExp}天</div>
              </div>

              {/* ATM IV */}
              <span className="font-mono text-[11px] text-white/55">{r.atmIV.toFixed(1)}%</span>

              {/* Straddle */}
              <div>
                <div className="font-mono text-[11px] font-bold text-[#a78bfa]">{fmtPct(r.straddlePct)}</div>
                <div className="text-[8.5px] text-white/55">{fmtUSD(r.straddleUSD)}</div>
              </div>

              {/* Up breakeven */}
              <div>
                <div className="font-mono text-[10.5px] text-[#25e889]">{fmtUSD(r.upBE)}</div>
                <div className="text-[8.5px] text-white/55">+{r.straddlePct.toFixed(2)}%</div>
              </div>

              {/* Down breakeven */}
              <div>
                <div className="font-mono text-[10.5px] text-[#FF5F57]">{fmtUSD(r.downBE)}</div>
                <div className="text-[8.5px] text-white/55">-{r.straddlePct.toFixed(2)}%</div>
              </div>

              {/* 25D Strangle */}
              <span className="font-mono text-[11px] text-[#FEBC2E]">
                {r.stranglePct !== null ? fmtPct(r.stranglePct) : '—'}
                {r.strangleWidth !== null && (
                  <span className="text-[8.5px] text-white/55 ml-1">±{r.strangleWidth.toFixed(0)}%</span>
                )}
              </span>

              {/* RR25 */}
              <span className="font-mono text-[11px] font-bold" style={{ color: rrColor }}>
                {r.rr25 >= 0 ? '+' : ''}{r.rr25.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-white/[0.04]">
        Straddle = 2× ATM Call（BS，r=0）· 25δ Strangle = 25δCall + 25δPut · BE = 现货 ± Straddle% · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// BTCETHSpreadWidget — BTC vs ETH DVOL 历史价差
// ═══════════════════════════════════════════════════════════════════════════════
//
// Spread = BTC DVOL − ETH DVOL. Positive = BTC vol premium, Negative = ETH vol premium.
// Useful for cross-asset vol arb and relative positioning.

function useDualHistory() {
  const [btc, setBtc]         = useState<HistoryData | null>(null);
  const [eth, setEth]         = useState<HistoryData | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let active = true;
    setTimedOut(false);
    const timeout = setTimeout(() => { if (active && (!btc || !eth)) setTimedOut(true); }, 20_000);
    const u1 = subscribeData<HistoryData>('history-BTC', () => fetchDeribitHistory('BTC'), HIST_TTL, d => { if (active) { setBtc(d); setTimedOut(false); } });
    const u2 = subscribeData<HistoryData>('history-ETH', () => fetchDeribitHistory('ETH'), HIST_TTL, d => { if (active) { setEth(d); setTimedOut(false); } });
    return () => { active = false; clearTimeout(timeout); u1(); u2(); };
  }, []);

  return { btc, eth, timedOut };
}

export const BTCETHSpreadWidget = () => {
  const { btc, eth, timedOut } = useDualHistory();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(btc && eth
      ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>
      : null
    );
    return () => setHeaderRight(null);
  }, [setHeaderRight, btc, eth]);

  if (!btc || !eth) return timedOut ? <HistLoadErr /> : <Skeleton />;

  const btcSeries = btc.dvolSeries;
  const ethSeries = eth.dvolSeries;
  const len = Math.min(btcSeries.length, ethSeries.length);
  if (len < 2) return <Skeleton />;

  // Align tails
  const btcA = btcSeries.slice(-len);
  const ethA = ethSeries.slice(-len);
  const spread = btcA.map((b, i) => b - ethA[i]);
  const currentSpread = spread[spread.length - 1];
  const currentBTC    = btcA[btcA.length - 1];
  const currentETH    = ethA[ethA.length - 1];

  // Spread percentile (52-week window)
  const sorted = [...spread].sort((a, b) => a - b);
  const pctile = spread.length > 1
    ? (sorted.filter(v => v <= currentSpread).length / sorted.length) * 100
    : 50;

  const spreadColor = currentSpread > 5 ? '#FEBC2E' : currentSpread < -5 ? '#a78bfa' : 'rgba(255,255,255,0.5)';
  const spreadLabel = currentSpread > 10 ? 'BTC vol 大幅溢价'
    : currentSpread > 4  ? 'BTC vol 偏贵'
    : currentSpread < -10 ? 'ETH vol 大幅溢价'
    : currentSpread < -4  ? 'ETH vol 偏贵'
    : '基本持平';

  const W = 540, H = 130, PX = 8, PY = 14;
  const spreadLo = Math.min(...spread) - 1;
  const spreadHi = Math.max(...spread) + 1;
  const spreadPts = mapPts(spread, W, H, spreadLo, spreadHi, PX, PY);
  const btcPts    = mapPts(btcA,   W, H, Math.min(...btcA, ...ethA) - 2, Math.max(...btcA, ...ethA) + 2, PX, PY);
  const ethPts    = mapPts(ethA,   W, H, Math.min(...btcA, ...ethA) - 2, Math.max(...btcA, ...ethA) + 2, PX, PY);

  // Zero line for spread chart
  const yZero = (H - PY) - ((0 - spreadLo) / (spreadHi - spreadLo)) * (H - 2 * PY);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats row */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: 'BTC DVOL', val: `${currentBTC.toFixed(1)}%`, color: '#FEBC2E' },
          { label: 'ETH DVOL', val: `${currentETH.toFixed(1)}%`, color: '#4ea1ff' },
          { label: 'Spread (BTC−ETH)', val: `${currentSpread >= 0 ? '+' : ''}${currentSpread.toFixed(1)}pp`, color: spreadColor },
          { label: '价差百分位', val: `${pctile.toFixed(0)}%ile`, color: spreadColor },
          { label: '解读', val: spreadLabel, color: spreadColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5 min-w-0">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Dual chart — two panels stacked */}
      <div className="flex flex-1 min-h-0 gap-2 px-3 pb-2">
        {/* DVOL overlay */}
        <div className="flex-1 min-w-0">
          <div className="text-[8.5px] text-white/55 mb-0.5 uppercase tracking-wider">DVOL 历史（90D）</div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
            <path d={area(ethPts, H, PY)} fill="url(#wg-blue)" />
            <polyline points={poly(ethPts)} fill="none" stroke="#4ea1ff" strokeWidth={1.2} opacity={0.7} />
            <path d={area(btcPts, H, PY)} fill="url(#wg-yellow)" />
            <polyline points={poly(btcPts)} fill="none" stroke="#FEBC2E" strokeWidth={1.4} opacity={0.85} />
            {/* Legend */}
            <line x1={PX} y1={8} x2={PX + 12} y2={8} stroke="#FEBC2E" strokeWidth={1.4} />
            <text x={PX + 15} y={11} fontSize={7} fill="rgba(255,255,255,0.3)">BTC</text>
            <line x1={PX + 36} y1={8} x2={PX + 48} y2={8} stroke="#4ea1ff" strokeWidth={1.2} />
            <text x={PX + 51} y={11} fontSize={7} fill="rgba(255,255,255,0.3)">ETH</text>
          </svg>
        </div>

        {/* Spread chart */}
        <div className="flex-1 min-w-0">
          <div className="text-[8.5px] text-white/55 mb-0.5 uppercase tracking-wider">价差（BTC − ETH，pp）</div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
            {/* Zero line */}
            {yZero > PY && yZero < H - PY && (
              <line x1={PX} y1={yZero} x2={W - PX} y2={yZero}
                stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} strokeDasharray="4,3" />
            )}
            {/* Fill above/below zero */}
            <path d={area(spreadPts, H, PY)} fill={`${spreadColor}12`} />
            <polyline points={poly(spreadPts)} fill="none" stroke={spreadColor} strokeWidth={1.5} opacity={0.9} />
            {/* Percentile annotation */}
            <text x={W - PX} y={PY} textAnchor="end" fontSize={7} fill="rgba(255,255,255,0.2)">
              {pctile.toFixed(0)}%ile
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// VolRegimeWidget — 波动率区间分类器
// ═══════════════════════════════════════════════════════════════════════════════
//
// Synthesises IV rank, VRP, term structure slope, skew, and funding
// into a named vol regime with a confidence score and playbook suggestion.

type VolRegime =
  | 'low-vol-complacent'
  | 'vol-expansion'
  | 'high-vol-fear'
  | 'vol-compression'
  | 'mean-revert'
  | 'unknown';

interface RegimeResult {
  regime: VolRegime;
  label: string;
  color: string;
  confidence: number;  // 0–100
  description: string;
  playbook: string[];
}

function classifyRegime(
  data: DeribitData,
  hist: HistoryData | null,
  flow: FlowData | null,
): RegimeResult {
  const ivr   = hist?.ivRankCurrent ?? 50;
  const vrpNow = (hist?.vrp?.length ?? 0) > 0
    ? hist!.vrp[hist!.vrp.length - 1].iv - hist!.vrp[hist!.vrp.length - 1].rv
    : 5;
  const dvolChange = hist?.dvolChange24h ?? 0;
  const exp = data.expiries;
  const slope = exp.length >= 2 ? exp[exp.length - 1].atmIV - exp[0].atmIV : 0;
  const skew30 = exp.length
    ? (exp.reduce((b, e) => Math.abs(e.daysToExp - 30) < Math.abs(b.daysToExp - 30) ? e : b, exp[0])?.rr25 ?? 0)
    : 0;
  const funding = flow?.annFunding ?? 0;

  let scores: Partial<Record<VolRegime, number>> = {};

  // Score each regime based on factor alignment
  // LOW-VOL COMPLACENT: low IVR, high VRP, normal-or-positive slope
  scores['low-vol-complacent'] = (
    (ivr < 30 ? 40 : ivr < 45 ? 20 : 0) +
    (vrpNow > 8 ? 35 : vrpNow > 4 ? 20 : 0) +
    (slope > 0 ? 15 : 0) +
    (funding > 20 ? 10 : 0) // complacency + high funding = crowded
  );

  // VOL EXPANSION: rising DVOL, low or negative VRP, skew going negative
  scores['vol-expansion'] = (
    (dvolChange > 2 ? 40 : dvolChange > 0.5 ? 20 : 0) +
    (vrpNow < 2 ? 30 : vrpNow < 5 ? 10 : 0) +
    (skew30 < -3 ? 25 : skew30 < -1 ? 10 : 0) +
    (funding < -5 ? 10 : 0)
  );

  // HIGH-VOL FEAR: high IVR, inverted term structure, very negative skew
  scores['high-vol-fear'] = (
    (ivr > 75 ? 40 : ivr > 60 ? 20 : 0) +
    (slope < -5 ? 35 : slope < -2 ? 15 : 0) +
    (skew30 < -5 ? 20 : skew30 < -2 ? 10 : 0) +
    (vrpNow < 0 ? 10 : 0)
  );

  // VOL COMPRESSION: falling DVOL, VRP expanding, term structure steepening
  scores['vol-compression'] = (
    (dvolChange < -1.5 ? 40 : dvolChange < -0.5 ? 20 : 0) +
    (vrpNow > 6 ? 30 : vrpNow > 3 ? 15 : 0) +
    (slope > 3 ? 20 : slope > 0 ? 10 : 0) +
    (ivr > 40 && ivr < 70 ? 10 : 0) // medium IVR falling
  );

  // MEAN-REVERT: mid IVR, moderate VRP, stable term structure
  scores['mean-revert'] = (
    (ivr >= 30 && ivr <= 65 ? 35 : 0) +
    (vrpNow >= 3 && vrpNow <= 9 ? 25 : 0) +
    (Math.abs(slope) < 4 ? 20 : 0) +
    (Math.abs(skew30) < 3 ? 15 : 0) +
    (Math.abs(dvolChange) < 1 ? 10 : 0)
  );

  const best = (Object.entries(scores) as [VolRegime, number][])
    .sort((a, b) => b[1] - a[1])[0];

  const regime = best[0];
  const rawScore = best[1];
  const confidence = Math.min(100, Math.round(rawScore * 1.1));

  const INFO: Record<VolRegime, { label: string; color: string; description: string; playbook: string[] }> = {
    'low-vol-complacent': {
      label: '低波 / 市场自满',
      color: '#25e889',
      description: `IV Rank ${ivr.toFixed(0)}%ile（低），VRP +${vrpNow.toFixed(1)}pp，期限结构正常——市场低估尾部风险。`,
      playbook: ['卖 IV 策略（Iron Condor、Strangle）溢价充足', '注意尾部风险：低波容易逆转为快速扩张', '资金费率偏高时做空 perp 对冲多头 Delta 风险'],
    },
    'vol-expansion': {
      label: '波动率扩张',
      color: '#FF5F57',
      description: `DVOL 24h +${dvolChange.toFixed(1)}pp，VRP 受压（+${vrpNow.toFixed(1)}pp），Skew ${skew30.toFixed(1)}%——空间正在打开。`,
      playbook: ['避免裸卖 vega；若已有 short vega 应收窄或对冲', '25D Put 或 OTM Put Spread 保护下行', '买入近端 Straddle 参与波动率重定价'],
    },
    'high-vol-fear': {
      label: '高波 / 恐慌区间',
      color: '#FF5F57',
      description: `IV Rank ${ivr.toFixed(0)}%ile（极高），期限结构倒挂（${slope.toFixed(1)}pp），Skew 极度负偏——恐慌溢价高峰。`,
      playbook: ['逆向考虑：卖近端 Put（高保护溢价），用远端对冲', 'Ratio Put Spread 可低成本或零成本构建', '等待 IV Rank 回落至 60% 以下再考虑卖方策略'],
    },
    'vol-compression': {
      label: '波动率收缩',
      color: '#4ea1ff',
      description: `DVOL 24h ${dvolChange.toFixed(1)}pp（下行），VRP 扩张至 +${vrpNow.toFixed(1)}pp——意味着卖 IV 窗口可能临近。`,
      playbook: ['日历价差（Calendar Spread）受益于期限溢价', 'Theta 策略窗口打开：短期 Condor 或 Strangle', '监控 DVOL 是否企稳；若反弹应及时止损'],
    },
    'mean-revert': {
      label: '均值回归区间',
      color: '#FEBC2E',
      description: `IV Rank ${ivr.toFixed(0)}%ile，VRP +${vrpNow.toFixed(1)}pp，结构平稳——无明显方向性信号。`,
      playbook: ['中性策略：Iron Condor 收取时间价值', '关注 Skew 偏向决定调整 Call/Put 比重', '保持仓位较小，等待更强方向信号'],
    },
    'unknown': {
      label: '信号不足',
      color: 'rgba(255,255,255,0.3)',
      description: '数据采集中，请稍候…',
      playbook: ['等待数据加载'],
    },
  };

  return { regime, confidence, ...INFO[regime] };
}

export const VolRegimeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }      = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }               = useDeribitOptions(coin);
  const { data: hist }         = useDeribitHistory(coin);
  const { data: flow }         = useFlowData(coin);
  const { setHeaderRight }     = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (!data) return <Skeleton />;

  const result = classifyRegime(data, hist, flow);

  // Confidence arc (SVG semicircle gauge)
  const GAUGE_R = 36, CX = 48, CY = 48;
  const angle = ((result.confidence / 100) * 180 - 180) * (Math.PI / 180);
  const nx = CX + GAUGE_R * Math.cos(angle);
  const ny = CY + GAUGE_R * Math.sin(angle);

  // Factor readout
  const ivr   = hist?.ivRankCurrent ?? null;
  const vrpNow = (hist?.vrp?.length ?? 0) > 0
    ? hist!.vrp[hist!.vrp.length - 1].iv - hist!.vrp[hist!.vrp.length - 1].rv
    : null;
  const exp   = data.expiries;
  const slope = exp.length >= 2 ? exp[exp.length - 1].atmIV - exp[0].atmIV : null;
  const skew30 = exp.length
    ? (exp.reduce((b, e) => Math.abs(e.daysToExp - 30) < Math.abs(b.daysToExp - 30) ? e : b, exp[0])?.rr25 ?? null)
    : null;

  const factors = [
    { label: 'IV Rank', val: ivr !== null ? `${ivr.toFixed(0)}%ile` : '—',
      ok: ivr !== null && ivr >= 30 && ivr <= 70 },
    { label: 'VRP', val: vrpNow !== null ? `+${vrpNow.toFixed(1)}pp` : '—',
      ok: vrpNow !== null && vrpNow > 2 },
    { label: '期限结构', val: slope !== null ? `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}pp` : '—',
      ok: slope !== null && slope > -3 },
    { label: '30D Skew', val: skew30 !== null ? `${skew30 >= 0 ? '+' : ''}${skew30.toFixed(2)}%` : '—',
      ok: skew30 !== null && Math.abs(skew30) < 3 },
    { label: '资金费率', val: flow ? `${flow.annFunding >= 0 ? '+' : ''}${flow.annFunding.toFixed(1)}%` : '—',
      ok: flow ? Math.abs(flow.annFunding) < 25 : false },
  ];

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex flex-1 min-h-0 gap-3 px-3 pt-2 pb-2">

        {/* Gauge + regime label */}
        <div className="flex flex-col items-center shrink-0" style={{ width: 100 }}>
          <svg width={96} height={56} viewBox="0 0 96 56">
            {/* Arc track */}
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${CX + GAUGE_R} ${CY}`}
              fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
            {/* Filled arc */}
            <path d={`M ${CX - GAUGE_R} ${CY} A ${GAUGE_R} ${GAUGE_R} 0 ${result.confidence > 50 ? 1 : 0} 1 ${nx.toFixed(1)} ${ny.toFixed(1)}`}
              fill="none" stroke={result.color} strokeWidth={4} strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${result.color}88)` }} />
            {/* Needle dot */}
            <circle cx={nx.toFixed(1)} cy={ny.toFixed(1)} r={3.5} fill={result.color} />
            {/* Confidence value */}
            <text x={CX} y={CY + 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={result.color}>
              {result.confidence}%
            </text>
            <text x={CX} y={CY + 13} textAnchor="middle" fontSize={6.5} fill="rgba(255,255,255,0.25)">置信度</text>
          </svg>
          <div className="text-[10px] font-bold text-center leading-tight mt-0.5" style={{ color: result.color }}>
            {result.label}
          </div>
        </div>

        {/* Description + factors */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="text-[10px] text-white/55 leading-relaxed">{result.description}</p>

          {/* Factor pills */}
          <div className="flex gap-1.5 flex-wrap">
            {factors.map(f => (
              <div key={f.label}
                className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 border"
                style={{
                  borderColor: f.ok ? 'rgba(37,232,137,0.2)' : 'rgba(248,113,113,0.2)',
                  background:  f.ok ? 'rgba(37,232,137,0.05)' : 'rgba(248,113,113,0.05)',
                }}>
                <span className="text-[8.5px] text-white/55">{f.label}</span>
                <span className="font-mono text-[9px] font-bold"
                  style={{ color: f.ok ? '#25e889' : '#FF5F57' }}>{f.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Playbook */}
        <div className="shrink-0 flex flex-col gap-1" style={{ width: 240 }}>
          <div className="text-[9px] font-bold text-white/55 uppercase tracking-wider mb-0.5">策略建议</div>
          {result.playbook.map((tip, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
                style={{ background: `${result.color}20`, color: result.color }}>
                {i + 1}
              </span>
              <span className="text-[9px] text-white/55 leading-snug">{tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PriceTargetProbWidget — 到达价格目标的概率（N(d₂) 矩阵）
// ═══════════════════════════════════════════════════════════════════════════════
//
// P(S_T > K) = N(d₂)  →  risk-neutral probability of expiring above strike K.
// Shows a strike × expiry probability grid colour-coded from 0% to 100%.

const PROB_STRIKE_OFFSETS = [-0.20, -0.15, -0.10, -0.07, -0.04, 0, +0.04, +0.07, +0.10, +0.15, +0.20];

export const PriceTargetProbWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  // Heavy computation: probGrid = 11 strikes × 6 expiries × IV interpolation per cell.
  // Memoised on data so it only recalculates when the options chain refreshes (every 90s).
  const computed = useMemo(() => {
    if (!data || !data.expiries.length) return null;
    const spot = data.spot;
    const exps = data.expiries.slice(0, 6);
    const d2 = (S: number, K: number, T: number, iv: number) => {
      if (T <= 0 || iv <= 0) return S >= K ? 1 : 0;
      const sigma = iv / 100;
      return (Math.log(S / K) - 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
    };
    const getStrikeIV = (e: ExpiryGroup, k: number): number => {
      const chain = [...e.calls, ...e.puts].filter(o => o.iv > 0).sort((a, b) => a.strike - b.strike);
      if (chain.length === 0) return e.atmIV;
      if (k <= chain[0].strike) return chain[0].iv;
      if (k >= chain[chain.length - 1].strike) return chain[chain.length - 1].iv;
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i].strike <= k && k <= chain[i + 1].strike) {
          const t = (k - chain[i].strike) / (chain[i + 1].strike - chain[i].strike);
          return chain[i].iv + t * (chain[i + 1].iv - chain[i].iv);
        }
      }
      return e.atmIV;
    };
    const strikes = PROB_STRIKE_OFFSETS.map(o =>
      Math.round(spot * (1 + o) / (spot > 10_000 ? 1_000 : 100)) * (spot > 10_000 ? 1_000 : 100)
    );
    const probGrid: number[][] = strikes.map(k =>
      exps.map(e => normCDF(d2(spot, k, e.T, getStrikeIV(e, k))) * 100)
    );
    return { spot, exps, strikes, probGrid };
  }, [data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.expiries.length || !computed) return <div className="p-3 text-[11px] text-white/55">暂无数据</div>;

  const { spot, exps, strikes, probGrid } = computed;

  // Colour: green→yellow→red from 100%→50%→0%
  const probColor = (p: number) => {
    if (p >= 80) return `rgba(37,232,137,${0.15 + (p - 80) / 20 * 0.5})`;
    if (p >= 50) return `rgba(245,158,11,${0.10 + (p - 50) / 30 * 0.35})`;
    return `rgba(248,113,113,${0.10 + (50 - p) / 50 * 0.55})`;
  };
  const probTextColor = (p: number) => {
    if (p >= 70) return '#25e889';
    if (p >= 45) return '#FEBC2E';
    return '#FF5F57';
  };

  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
  const CELL_H = 28, CELL_W = 74, LABEL_W = 78;
  const totalW = LABEL_W + exps.length * CELL_W;
  const totalH = (strikes.length + 1) * CELL_H;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1.5 pb-1 text-[9px] text-white/55 shrink-0">
        P(收盘 &gt; 行权价) = N(d₂)·100%，基于当前 ATM IV · 风险中性概率，非真实概率
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <svg viewBox={`0 0 ${totalW} ${totalH}`} width={totalW} height={totalH} style={{ display: 'block' }}>
          {/* Header row */}
          {exps.map((e, j) => (
            <text key={e.label}
              x={LABEL_W + j * CELL_W + CELL_W / 2} y={CELL_H / 2 + 4}
              textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)" fontWeight={600}>
              {e.label}
            </text>
          ))}

          {/* Data rows */}
          {strikes.map((k, i) => {
            const y = (i + 1) * CELL_H;
            const isAtm = Math.abs(k - spot) / spot < 0.025;
            const pctFromSpot = ((k - spot) / spot) * 100;
            return (
              <g key={k}>
                {/* Strike label */}
                <text x={LABEL_W - 6} y={y + CELL_H / 2 + 4}
                  textAnchor="end" fontSize={9}
                  fill={isAtm ? '#FEBC2E' : 'rgba(255,255,255,0.35)'}
                  fontWeight={isAtm ? 700 : 400}>
                  ${fmtK(k)}
                </text>
                {/* Offset % */}
                <text x={LABEL_W - 6} y={y + CELL_H / 2 + 13}
                  textAnchor="end" fontSize={7}
                  fill={isAtm ? '#FEBC2E88' : 'rgba(255,255,255,0.15)'}>
                  {pctFromSpot >= 0 ? '+' : ''}{pctFromSpot.toFixed(0)}%
                </text>
                {/* Cells */}
                {exps.map((_, j) => {
                  const p = probGrid[i][j];
                  return (
                    <g key={j}>
                      <rect x={LABEL_W + j * CELL_W + 1} y={y + 1}
                        width={CELL_W - 2} height={CELL_H - 2}
                        fill={probColor(p)} rx={3} />
                      <text x={LABEL_W + j * CELL_W + CELL_W / 2} y={y + CELL_H / 2 + 3.5}
                        textAnchor="middle" fontSize={9} fontWeight={600}
                        fill={probTextColor(p)}>
                        {p.toFixed(0)}%
                      </text>
                    </g>
                  );
                })}
                {/* Spot row highlight */}
                {isAtm && (
                  <rect x={0} y={y + 1} width={LABEL_W - 8} height={CELL_H - 2}
                    fill="rgba(245,158,11,0.06)" rx={2} />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// EWMAForecastWidget — AR(1) DVOL 均值回归预测
// ═══════════════════════════════════════════════════════════════════════════════

export const EWMAForecastWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }   = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: hist, timedOut }  = useDeribitHistory(coin);
  const { data: optData }         = useDeribitOptions(coin);
  const { setHeaderRight }  = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {hist && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, hist]);

  if (!hist || !optData) return timedOut ? <HistLoadErr /> : <Skeleton />;

  const dvol    = hist.dvolSeries;
  const current = dvol[dvol.length - 1];
  const { alpha, beta, mu } = fitAR1(dvol);

  const HORIZONS = [7, 14, 30, 60] as const;
  const forecasts = HORIZONS.map(h => ({
    horizon: h,
    forecast: forecastAR1(current, alpha, beta, h),
    // Market IV at same tenor
    marketIV: optData.expiries.length
      ? optData.expiries.reduce((b, e) =>
          Math.abs(e.daysToExp - h) < Math.abs(b.daysToExp - h) ? e : b,
          optData.expiries[0]).atmIV
      : current,
  }));

  const fmtColor = (f: number, m: number) => {
    const diff = f - m;
    if (diff < -3) return '#25e889';  // forecast < market → sell IV
    if (diff > 3)  return '#FF5F57';  // forecast > market → buy IV
    return '#FEBC2E';
  };

  // Forecast path for chart
  const chartLen = 30; // show last 30 days + 60 day forecast
  const histSlice = dvol.slice(-chartLen);
  const forecastPath = Array.from({ length: 61 }, (_, i) =>
    forecastAR1(current, alpha, beta, i)
  );

  const allVals = [...histSlice, ...forecastPath, mu];
  const lo = Math.floor(Math.min(...allVals) * 0.94 / 5) * 5;
  const hi = Math.ceil(Math.max(...allVals) * 1.06 / 5) * 5;
  const W = 400, H = 140, PX = 28, PY = 12;

  const histPts  = mapPts(histSlice,   W * 0.4, H, lo, hi, PX, PY);
  const fcstPts  = mapPts(forecastPath, W * 0.6, H, lo, hi, 0, PY);
  // Shift forecast pts to start at end of history
  const xJoin = PX + (W - PX - PX) * 0.4;
  const fcstShifted: [number, number][] = fcstPts.map(([x, y]) => [xJoin + x, y]);

  const yMu = (H - PY) - ((mu - lo) / (hi - lo)) * (H - 2 * PY);
  const yCurr = histPts[histPts.length - 1]?.[1] ?? 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Model params */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 DVOL', val: `${current.toFixed(1)}%`, color: BRAND },
          { label: '长期均值 μ', val: `${mu.toFixed(1)}%`, color: 'rgba(255,255,255,0.5)' },
          { label: '均值回归速度 β', val: beta.toFixed(3), color: BLUE },
          { label: '偏差', val: `${(current - mu >= 0 ? '+' : '')}${(current - mu).toFixed(1)}pp`, color: current > mu ? '#FF5F57' : '#25e889' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 gap-3 px-3 pb-2">
        {/* Chart */}
        <div className="flex-1 min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
            {/* Long-run mean */}
            <line x1={PX} y1={yMu} x2={W - 4} y2={yMu}
              stroke="rgba(255,255,255,0.12)" strokeWidth={0.8} strokeDasharray="5,4" />
            <text x={W - 4} y={yMu - 2} textAnchor="end" fontSize={7} fill="rgba(255,255,255,0.2)">μ={mu.toFixed(0)}</text>

            {/* Historical DVOL */}
            <path d={area(histPts, H, PY)} fill="url(#wg-green)" />
            <polyline points={poly(histPts)} fill="none" stroke={BRAND} strokeWidth={1.4} opacity={0.85} />

            {/* Forecast path (dashed) */}
            <path d={smooth(fcstShifted)} fill="none"
              stroke="#a78bfa" strokeWidth={1.2} strokeDasharray="4,3" opacity={0.8} />

            {/* Confidence band (±1σ approx) */}
            {fcstShifted.length > 0 && (() => {
              const sigma = hist.dvolSeries.reduce((s, v, i, arr) => {
                if (i === 0) return 0;
                return s + Math.pow(v - arr[i-1], 2);
              }, 0);
              const dailyStd = Math.sqrt(sigma / (hist.dvolSeries.length - 1));
              const bandTop: [number,number][] = fcstShifted.map(([x,y], i) => {
                const band = dailyStd * Math.sqrt(i + 1) * 0.8;
                const dy = band / (hi - lo) * (H - 2 * PY);
                return [x, y - dy] as [number,number];
              });
              const bandBot: [number,number][] = fcstShifted.map(([x,y], i) => {
                const band = dailyStd * Math.sqrt(i + 1) * 0.8;
                const dy = band / (hi - lo) * (H - 2 * PY);
                return [x, y + dy] as [number,number];
              });
              return (
                <path
                  d={`${smooth(bandTop)} L ${bandBot.slice().reverse().map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`}
                  fill="rgba(167,139,250,0.08)"
                />
              );
            })()}

            {/* Join dot */}
            <circle cx={xJoin} cy={yCurr} r={2.5} fill="#a78bfa" />

            {/* Y labels */}
            {[lo, Math.round((lo+hi)/2), hi].map(v => {
              const y = (H - PY) - ((v - lo) / (hi - lo)) * (H - 2 * PY);
              return <text key={v} x={PX - 3} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>;
            })}

            {/* X labels */}
            <text x={PX} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">-30D</text>
            <text x={xJoin} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">今</text>
            <text x={W - 8} y={H - 1} fontSize={7} fill={TXT} textAnchor="middle">+60D</text>
          </svg>
        </div>

        {/* Forecast table */}
        <div className="shrink-0 flex flex-col gap-1.5" style={{ width: 170 }}>
          <div className="text-[9px] font-bold text-white/55 uppercase tracking-wider mb-0.5">预测 vs 市场 IV</div>
          {forecasts.map(f => {
            const diff = f.forecast - f.marketIV;
            const col = fmtColor(f.forecast, f.marketIV);
            const signal = diff < -3 ? '↓ IV 偏贵' : diff > 3 ? '↑ IV 偏便宜' : '≈ 合理';
            return (
              <div key={f.horizon}
                className="rounded-[7px] border px-2.5 py-1.5"
                style={{ borderColor: `${col}25`, background: `${col}08` }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] text-white/55">+{f.horizon}D 预测</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: col }}>{signal}</span>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <div className="text-[9px] text-white/55 mb-0">AR(1)</div>
                    <div className="font-mono text-[11px] font-bold" style={{ color: col }}>{f.forecast.toFixed(1)}%</div>
                  </div>
                  <div className="text-white/55 text-[9px] mb-0.5">vs</div>
                  <div>
                    <div className="text-[9px] text-white/55 mb-0">市场 IV</div>
                    <div className="font-mono text-[11px] text-white/50">{f.marketIV.toFixed(1)}%</div>
                  </div>
                  <div className="ml-auto">
                    <div className="font-mono text-[10px] font-bold" style={{ color: col }}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// TenorIVHeatmapWidget removed — session-only, always empty on page load

// ── SpotTickerWidget ──────────────────────────────────────────────────────
// Compact real-time market overview: price flash, 24h range, DVOL, funding, OI
interface TickerSnapshot {
  spot: number;
  change24hPct: number; // from perp stats.price_change
  high24h: number;
  low24h: number;
  dvol: number;
  fundingAnn: number; // annualised %
  optOI_M: number; // USD millions
  optVol24h_M: number; // USD millions
}
const TICKER_CACHE2 = new Map<string, { data: TickerSnapshot; ts: number }>();

// ── useTickerSnapshotWS ───────────────────────────────────────────────────────
// Assembles TickerSnapshot from 3 WS channels (spot · DVOL · perp ticker).
// OI / Vol fields still come from the REST options-chain cache (updated every 5min).
// Also writes TICKER_CACHE2 so evalAlerts() keeps working.
function useTickerSnapshotWS(coin: Coin): TickerSnapshot | null {
  const partialRef = useRef<{
    spot?: number; dvol?: number; change24hPct?: number;
    high24h?: number; low24h?: number; fundingAnn?: number;
  }>({});
  const pendingRef   = useRef<TickerSnapshot | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snap, setSnap] = useState<TickerSnapshot | null>(() => TICKER_CACHE2.get(coin)?.data ?? null);

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
      TICKER_CACHE2.set(coin, { data: t, ts: Date.now() });
      pendingRef.current = t;
      // Throttle React re-renders to WS_FLUSH_MS (2 Hz max)
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          if (alive && pendingRef.current) setSnap(pendingRef.current);
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
    const u3 = DERIBIT_WS.subscribe<any>(
      `ticker.${cur}-PERPETUAL.raw`,
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

// ── useOptionTradesWS ─────────────────────────────────────────────────────────
// Real-time option trade stream via WS. Replaces pollOptionTrades REST polling.
// Maintains a 2000-trade newest-first buffer; also feeds processLargeTrades /
// processPremiumFlow so AlertsWidget metrics remain available.
function useOptionTradesWS(coin: Coin): RawOptionTrade[] {
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

    const unsub = DERIBIT_WS.subscribe<any[]>(
      `trades.option.${cur}.raw`,
      (batch) => {
        if (!alive) return;
        const newTrades: RawOptionTrade[] = [];
        for (const t of (Array.isArray(batch) ? batch : [])) {
          if (seenRef.current.has(t.trade_id)) continue;
          seenRef.current.add(t.trade_id);
          const parts = (t.instrument_name as string).split('-');
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
        // Trim seen set
        if (seenRef.current.size > 5000) {
          const arr = [...seenRef.current];
          arr.slice(0, arr.length - 3000).forEach(id => seenRef.current.delete(id));
        }
        const updated = [...newTrades, ...bufRef.current].slice(0, 2000);
        bufRef.current = updated;
        // Alert aggregators run immediately (they write to module-level maps, not React state)
        processLargeTrades(coin, updated, 0);
        processPremiumFlow(coin, updated);
        // Throttle the React re-render to WS_FLUSH_MS
        dirtyRef.current = true;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (alive && dirtyRef.current) { dirtyRef.current = false; setTrades([...bufRef.current]); }
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

// ── useOrderbookWS ────────────────────────────────────────────────────────────
// Live order-book for PERPETUAL via WS. Replaces fetchOrderbook REST polling.
// First WS message is a snapshot; subsequent messages apply incremental changes.
type OBEntry = [number, number];
function useOrderbookWS(coin: Coin): { bids: OBEntry[]; asks: OBEntry[]; mark: number; spread: number } | null {
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

    const unsub = DERIBIT_WS.subscribe<any>(
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
        // Throttle sort+slice+setState to WS_FLUSH_MS — maps update every 100ms, UI at 2Hz
        dirtyRef.current = true;
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            if (!alive || !dirtyRef.current) return;
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

export const SpotTickerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevSpotRef = useRef<number | undefined>(undefined);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snap = useTickerSnapshotWS(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  // Flash when spot price changes
  useEffect(() => {
    if (!snap) return;
    if (prevSpotRef.current !== undefined && snap.spot !== prevSpotRef.current) {
      setFlash(snap.spot > prevSpotRef.current ? 'up' : 'down');
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 500);
    }
    prevSpotRef.current = snap.spot;
  }, [snap?.spot]);

  if (!snap) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>
  );

  const fmtPrice = (p: number) =>
    p >= 10000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(2);

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className="flex flex-col items-center gap-0.5 min-w-[64px]">
      <span className="text-[9px] text-white/55 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <span className="text-[13px] font-mono font-bold tnum leading-none" style={{ color: color ?? 'var(--nexus-accent)' }}>{value}</span>
    </div>
  );

  const flashBg = flash === 'up' ? 'rgba(37,167,80,0.06)' : flash === 'down' ? 'rgba(244,63,94,0.06)' : 'transparent';
  const priceColor = flash === 'up' ? 'var(--nexus-green)' : flash === 'down' ? 'var(--nexus-red)' : '#F0F0EE';
  const upColor = 'var(--nexus-green)';
  const dnColor = 'var(--nexus-red)';

  return (
    <div className="w-full h-full flex items-center justify-around px-6 transition-colors duration-500" style={{ background: flashBg }}>
      {/* Spot price + 24h change */}
      <div className="flex flex-col items-center">
        <span className="text-[9px] text-white/55 uppercase tracking-wider mb-0.5">{coin} / USD</span>
        <span className="text-[28px] font-mono font-bold tnum leading-none transition-colors duration-300" style={{ color: priceColor }}>
          {fmtPrice(snap.spot)}
        </span>
        <span className="text-[11px] font-mono font-bold tnum mt-0.5" style={{ color: snap.change24hPct >= 0 ? upColor : dnColor }}>
          {snap.change24hPct >= 0 ? '▲' : '▼'} {Math.abs(snap.change24hPct).toFixed(2)}%
        </span>
      </div>

      <div className="h-10 w-px bg-white/8" />

      <Stat label="24H 高" value={fmtPrice(snap.high24h)} color={upColor} />
      <Stat label="24H 低" value={fmtPrice(snap.low24h)} color={dnColor} />

      <div className="h-10 w-px bg-white/8" />

      <Stat label="DVOL" value={snap.dvol > 0 ? `${snap.dvol.toFixed(1)}%` : '—'} />
      <Stat
        label="资金费率/年"
        value={`${snap.fundingAnn >= 0 ? '+' : ''}${snap.fundingAnn.toFixed(1)}%`}
        color={snap.fundingAnn >= 0 ? upColor : dnColor}
      />

      <div className="h-10 w-px bg-white/8" />

      <Stat label="期权 OI" value={`$${snap.optOI_M.toFixed(0)}M`} />
      <Stat label="期权成交" value={`$${snap.optVol24h_M.toFixed(0)}M`} />
    </div>
  );
};

// OIDeltaWidget removed — session-only, always empty on page load


// ── GreeksScenarioWidget ──────────────────────────────────────────────────
// ATM Straddle P&L scenario matrix: rows = spot %, cols = IV additive shift
const SCEN_SPOT = [-15, -10, -7, -5, -3, -1, 0, 1, 3, 5, 7, 10, 15];
const SCEN_IV   = [-20, -10, -5, 0, 5, 10, 20];

export const GreeksScenarioWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expIdx, setExpIdx] = useState(0);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (alive) { setDdata(d); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading || !ddata) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>
  );

  const expiries = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0).slice(0, 6);
  if (!expiries.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>
  );

  const safeIdx = Math.min(expIdx, expiries.length - 1);
  const exp = expiries[safeIdx];
  const S = ddata.spot;
  // Nearest strike to spot
  const allStrikes = [...exp.calls.map(c => c.strike), ...exp.puts.map(p => p.strike)];
  const K = allStrikes.reduce((best, s) => Math.abs(s - S) < Math.abs(best - S) ? s : best, allStrikes[0] ?? S);
  const T = Math.max(exp.daysToExp / 365, 0.0027); // at least 1 day
  const iv0 = exp.atmIV / 100;

  // Initial straddle price
  const price0 = bsCall(S, K, T, iv0) + bsPut(S, K, T, iv0);

  // P&L matrix [spotStep][ivShift]
  const matrix: number[][] = SCEN_SPOT.map(sp => {
    const newS = S * (1 + sp / 100);
    return SCEN_IV.map(ds => {
      const newIV = Math.max(0.01, iv0 + ds / 100);
      const newPrice = bsCall(newS, K, T, newIV) + bsPut(newS, K, T, newIV);
      return price0 > 0 ? (newPrice - price0) / price0 * 100 : 0;
    });
  });

  const maxAbs = Math.max(...matrix.flat().map(Math.abs), 1);
  const cellColor = (v: number) => {
    const t = Math.min(Math.abs(v) / maxAbs, 1);
    if (v > 0.5) return `rgba(37,167,80,${0.12 + t * 0.6})`;
    if (v < -0.5) return `rgba(244,63,94,${0.12 + t * 0.6})`;
    return 'rgba(255,255,255,0.03)';
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry selector + info */}
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 shrink-0 flex-wrap">
        {expiries.map((e, i) => (
          <button
            key={e.label}
            onClick={() => setExpIdx(i)}
            className="px-2 py-0.5 rounded text-[10px] font-mono transition-colors"
            style={{
              background: i === safeIdx ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
              color: i === safeIdx ? 'var(--nexus-accent)' : '#6e6e6e',
              border: `1px solid ${i === safeIdx ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
            }}>
            {e.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-white/55 font-mono">
          K={K.toLocaleString()} · IV={(iv0 * 100).toFixed(1)}% · {exp.daysToExp}d
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 56 }} />
            {SCEN_IV.map(ds => <col key={ds} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="text-left text-[9px] text-white/55 pb-1 pr-2 font-normal">Spot↓/IV→</th>
              {SCEN_IV.map(ds => (
                <th key={ds} className="text-center text-[9px] font-mono pb-1 px-0.5"
                  style={{ color: ds < 0 ? 'var(--nexus-red)' : ds > 0 ? 'var(--nexus-green)' : '#9a9a9a' }}>
                  {ds > 0 ? '+' : ''}{ds}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCEN_SPOT.map((sp, ri) => (
              <tr key={sp}>
                <td
                  className="pr-2 py-[3px] text-[9px] font-mono text-right"
                  style={{
                    color: sp < 0 ? 'var(--nexus-red)' : sp > 0 ? 'var(--nexus-green)' : '#9a9a9a',
                    fontWeight: sp === 0 ? 700 : 400,
                    background: sp === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  }}>
                  {sp > 0 ? '+' : ''}{sp}%
                </td>
                {SCEN_IV.map((_, ci) => {
                  const v = matrix[ri][ci];
                  return (
                    <td
                      key={ci}
                      className="text-center px-0.5 py-[3px]"
                      title={`Spot ${sp > 0 ? '+' : ''}${sp}%, IV ${SCEN_IV[ci] > 0 ? '+' : ''}${SCEN_IV[ci]}% → ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
                      style={{
                        background: cellColor(v),
                        color: Math.abs(v) > maxAbs * 0.25 ? '#fff' : '#6e6e6e',
                        borderRadius: 3,
                      }}>
                      {v >= 0 ? '+' : ''}{v.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// SHARED OPTION TRADE STREAM
// Polls get_last_trades_by_currency every 10 s; deduplicates by trade_id.
// All widgets below read from this shared buffer.
// ═══════════════════════════════════════════════════════════════════════════

interface RawOptionTrade {
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
// Cumulative premium-flow accumulators (persist across re-renders)
interface PFlowAcc { cumCallNet: number; cumPutNet: number }
const PFLOW_ACC    = new Map<string, PFlowAcc>();                          // coin → running totals
const PFLOW_SERIES = new Map<string, { ts: number; c: number; p: number }[]>(); // coin → max 360 pts
const PFLOW_LAST   = new Map<string, string>();                            // coin → last processed trade id

function processPremiumFlow(coin: Coin, trades: RawOptionTrade[]): void {
  if (!PFLOW_ACC.has(coin)) PFLOW_ACC.set(coin, { cumCallNet: 0, cumPutNet: 0 });
  if (!PFLOW_SERIES.has(coin)) PFLOW_SERIES.set(coin, []);

  const acc = PFLOW_ACC.get(coin)!;
  const buf = PFLOW_SERIES.get(coin)!;
  const lastId = PFLOW_LAST.get(coin);

  // trades are newest-first; find index of last processed
  const lastIdx = lastId ? trades.findIndex(t => t.id === lastId) : trades.length;
  const unprocessed = trades.slice(0, lastIdx).reverse(); // oldest-first new trades

  if (unprocessed.length === 0) return;
  for (const t of unprocessed) {
    const sign = t.direction === 'buy' ? 1 : -1;
    if (t.optType === 'C') acc.cumCallNet += sign * t.premiumUSD;
    else                    acc.cumPutNet  += sign * t.premiumUSD;
  }
  buf.push({ ts: Date.now(), c: acc.cumCallNet, p: acc.cumPutNet });
  if (buf.length > 360) buf.splice(0, buf.length - 360);
  PFLOW_LAST.set(coin, trades[0]?.id ?? lastId ?? '');
}

// PremiumFlowWidget removed — session-only. processPremiumFlow still runs inside LargeTradeAlertWidget
// so that AlertsWidget callflow/putflow metrics remain available.

// ── LargeTradeAlertWidget ─────────────────────────────────────────────────
// Live feed of large-notional option trades in this session.
const LARGE_BUF = new Map<string, RawOptionTrade[]>(); // coin → newest-first, max 200
const LARGE_SEEN_IDS = new Map<string, Set<string>>();

function processLargeTrades(coin: Coin, trades: RawOptionTrade[], minUSD: number): void {
  if (!LARGE_SEEN_IDS.has(coin)) LARGE_SEEN_IDS.set(coin, new Set());
  const seen = LARGE_SEEN_IDS.get(coin)!;
  const buf  = LARGE_BUF.get(coin) ?? [];
  let dirty  = false;
  for (const t of trades) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.notionalUSD >= minUSD) { buf.unshift(t); dirty = true; }
  }
  if (dirty) {
    if (buf.length > 200) buf.splice(200);
    LARGE_BUF.set(coin, buf);
  }
}

export const LargeTradeAlertWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [threshold, setThreshold] = useState(500_000);    // $500k notional
  const [filter, setFilter] = useState<'ALL' | 'C' | 'P'>('ALL');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <CoinTabs v={coin} set={setCoin} />
        <select
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          className="text-[9px] bg-transparent border border-white/10 rounded px-1 text-white/65">
          {[100_000, 250_000, 500_000, 1_000_000, 2_000_000].map(v => (
            <option key={v} value={v}>${(v / 1e6).toFixed(v < 1e6 ? 1 : 0)}M+</option>
          ))}
        </select>
        {(['ALL', 'C', 'P'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-1.5 py-0.5 rounded text-[9px] transition-colors"
            style={{
              background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: f === 'C' ? 'var(--nexus-green)' : f === 'P' ? 'var(--nexus-red)' : '#9a9a9a',
            }}>{f}</button>
        ))}
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, threshold, filter]);

  // WS stream — processLargeTrades + processPremiumFlow are called inside useOptionTradesWS
  useOptionTradesWS(coin);

  // Pull filtered large trades from the shared LARGE_BUF (updated by processLargeTrades in hook)
  const allTrades = LARGE_BUF.get(coin) ?? [];
  const visible = allTrades.filter(t =>
    t.notionalUSD >= threshold && (filter === 'ALL' || t.optType === filter)
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0">
        <span className="text-[9px] text-white/55">{visible.length} 条记录（会话内）</span>
      </div>
      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">
          等待大单…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
          {/* Header row */}
          <div className="grid text-[9px] text-white/55 uppercase tracking-wider pb-1 border-b border-white/6"
            style={{ gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px' }}>
            <span>时间</span><span>到期</span><span className="text-right">行权价</span>
            <span>类型</span><span>方向</span><span className="text-right">IV</span>
            <span className="text-right">权利金</span><span className="text-right">名义</span>
          </div>
          {visible.map(t => {
            const dirColor = t.direction === 'buy' ? 'var(--nexus-green)' : 'var(--nexus-red)';
            const typeColor = t.optType === 'C' ? 'var(--nexus-green)' : 'var(--nexus-red)';
            const time = new Date(t.ts).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div key={t.id}
                className="grid items-center py-[3px] border-b border-white/4 hover:bg-white/2 transition-colors"
                style={{ gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px' }}>
                <span className="text-[9px] font-mono text-white/55">{time}</span>
                <span className="text-[9px] font-mono text-white/65">{t.expiry}</span>
                <span className="text-[9px] font-mono text-white/85 text-right">{t.strike.toLocaleString()}</span>
                <span className="text-[9px] font-bold text-center" style={{ color: typeColor }}>{t.optType}</span>
                <span className="text-[9px] font-bold text-center" style={{ color: dirColor }}>
                  {t.direction === 'buy' ? '买' : '卖'}
                </span>
                <span className="text-[9px] font-mono text-right text-white/80">{t.iv.toFixed(1)}%</span>
                <span className="text-[9px] font-mono text-right" style={{ color: dirColor }}>
                  ${(t.premiumUSD / 1e3).toFixed(0)}K
                </span>
                <span className="text-[9px] font-mono text-right text-white/65">
                  ${(t.notionalUSD / 1e6).toFixed(2)}M
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── CalendarSpreadWidget ──────────────────────────────────────────────────
// ATM IV calendar spreads between consecutive expiries (vol points + %).
export const CalendarSpreadWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>;

  interface SpreadRow { label: string; near: string; far: string; nearIV: number; farIV: number; spreadVol: number; spreadPct: number }
  const rows: SpreadRow[] = [];
  for (let i = 0; i < exps.length - 1; i++) {
    const n = exps[i]; const f = exps[i + 1];
    const spreadVol = f.atmIV - n.atmIV;
    const spreadPct = n.atmIV > 0 ? (spreadVol / n.atmIV) * 100 : 0;
    rows.push({ label: `${n.label} / ${f.label}`, near: n.label, far: f.label, nearIV: n.atmIV, farIV: f.atmIV, spreadVol, spreadPct });
  }
  const maxAbsVol = Math.max(...rows.map(r => Math.abs(r.spreadVol)), 1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-white/55">
        ATM IV 日历价差（近端 → 远端，vol pts）
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {rows.map(r => {
          const barW = (Math.abs(r.spreadVol) / maxAbsVol) * 100;
          const color = r.spreadVol >= 0 ? 'var(--nexus-accent)' : 'var(--nexus-red)';
          return (
            <div key={r.label} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/65">{r.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-white/55">{r.nearIV.toFixed(1)}% → {r.farIV.toFixed(1)}%</span>
                  <span className="text-[11px] font-mono font-bold tnum w-[60px] text-right"
                    style={{ color }}>
                    {r.spreadVol >= 0 ? '+' : ''}{r.spreadVol.toFixed(1)}vp
                  </span>
                  <span className="text-[9px] font-mono w-[44px] text-right"
                    style={{ color: r.spreadPct >= 0 ? '#6e6e6e' : 'var(--nexus-red)' }}>
                    {r.spreadPct >= 0 ? '+' : ''}{r.spreadPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="h-[5px] rounded-full overflow-hidden bg-white/4">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: color, opacity: 0.7 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── ForwardVolWidget ──────────────────────────────────────────────────────
// Implied forward volatility between consecutive tenor pairs.
// Formula: σ_fwd = sqrt(max(0, (σ2²·T2 − σ1²·T1) / (T2 − T1)))
export const ForwardVolWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>;

  interface FwdRow { pair: string; T1d: number; T2d: number; iv1: number; iv2: number; fwdVol: number; premium: number }
  const rows: FwdRow[] = [];
  for (let i = 0; i < exps.length - 1; i++) {
    const e1 = exps[i]; const e2 = exps[i + 1];
    const T1 = e1.daysToExp / 365; const T2 = e2.daysToExp / 365;
    const v1 = e1.atmIV / 100;     const v2 = e2.atmIV / 100;
    const variance = (v2 * v2 * T2 - v1 * v1 * T1) / (T2 - T1);
    const fwdVol = variance > 0 ? Math.sqrt(variance) * 100 : 0;
    const premium = fwdVol - e2.atmIV; // forward vs far-end spot vol
    rows.push({ pair: `${e1.label}→${e2.label}`, T1d: e1.daysToExp, T2d: e2.daysToExp, iv1: e1.atmIV, iv2: e2.atmIV, fwdVol, premium });
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-white/55">
        隐含远期波动率（σ_fwd）vs 即期 ATM IV
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[9px] text-white/55 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal">区间</th>
              <th className="text-right pb-1.5 font-normal">近端IV</th>
              <th className="text-right pb-1.5 font-normal">远端IV</th>
              <th className="text-right pb-1.5 font-normal">远期σ</th>
              <th className="text-right pb-1.5 font-normal">溢价</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const premColor = r.premium > 2 ? 'var(--nexus-green)' : r.premium < -2 ? 'var(--nexus-red)' : '#9a9a9a';
              return (
                <tr key={r.pair} className="border-t border-white/4">
                  <td className="py-1.5 text-white/65 text-[9px]">{r.pair}</td>
                  <td className="py-1.5 text-right text-white/65">{r.iv1.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-white/65">{r.iv2.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold text-white/85">{r.fwdVol.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: premColor }}>
                    {r.premium >= 0 ? '+' : ''}{r.premium.toFixed(1)}vp
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── GammaPinWidget ────────────────────────────────────────────────────────
// Identifies near-expiry strikes near spot with concentrated OI — likely gamma pin candidates.
export const GammaPinWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const S = ddata.spot;
  interface PinCandidate {
    strike: number; expiry: string; daysToExp: number;
    callOI: number; putOI: number; totalOI: number;
    distPct: number; gamma: number; pinScore: number;
  }

  const candidates: PinCandidate[] = [];
  for (const exp of ddata.expiries) {
    if (exp.daysToExp > 14 || exp.daysToExp < 0) continue; // only ≤14d expiries
    const T = Math.max(exp.daysToExp / 365, 0.001);
    const iv = exp.atmIV / 100;
    // Build OI map by strike
    const oiMap = new Map<number, { call: number; put: number }>();
    for (const c of exp.calls) {
      const e = oiMap.get(c.strike) ?? { call: 0, put: 0 };
      e.call = c.oi; oiMap.set(c.strike, e);
    }
    for (const p of exp.puts) {
      const e = oiMap.get(p.strike) ?? { call: 0, put: 0 };
      e.put = p.oi; oiMap.set(p.strike, e);
    }
    for (const [strike, { call, put }] of oiMap) {
      const distPct = Math.abs(strike - S) / S * 100;
      if (distPct > 3) continue; // within 3% of spot
      const totalOI = call + put;
      if (totalOI < 10) continue;
      const gamma = bsGamma(S, strike, T, iv);
      // Pin score: OI × gamma × 1/(1 + daysToExp) — close-to-expiry × high OI × high gamma
      const pinScore = totalOI * gamma * S * S / 100 / (1 + exp.daysToExp);
      candidates.push({ strike, expiry: exp.label, daysToExp: exp.daysToExp, callOI: call, putOI: put, totalOI, distPct, gamma, pinScore });
    }
  }

  candidates.sort((a, b) => b.pinScore - a.pinScore);
  const top = candidates.slice(0, 8);

  if (top.length === 0) return (
    <div className="w-full h-full flex items-center justify-center flex-col gap-1">
      <span className="text-[13px] text-white/55">✓</span>
      <span className="text-[11px] text-white/55">7日内无 Gamma 钉牢候选（无近期高OI集中）</span>
    </div>
  );

  const maxScore = top[0].pinScore;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-white/55">
        ≤7日到期 · Spot 3% 范围内 · 高OI集中 → 钉牢候选
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {top.map((c, i) => {
          const barW = (c.pinScore / maxScore) * 100;
          const isBelowSpot = c.strike < S;
          const distLabel = `${isBelowSpot ? '▼' : '▲'}${c.distPct.toFixed(2)}%`;
          const distColor = isBelowSpot ? 'var(--nexus-red)' : 'var(--nexus-green)';
          return (
            <div key={`${c.expiry}-${c.strike}`} className="flex items-center gap-2 py-1 border-b border-white/4">
              <span className="text-[9px] text-white/55 w-3 shrink-0">#{i + 1}</span>
              <span className="text-[10px] font-mono font-bold text-white/85 w-[72px] shrink-0">
                {c.strike.toLocaleString()}
              </span>
              <span className="text-[9px] font-mono text-white/55 w-[52px] shrink-0">{c.expiry}</span>
              <span className="text-[9px] font-mono w-[36px] shrink-0" style={{ color: distColor }}>{distLabel}</span>
              <span className="text-[9px] font-mono text-white/55 w-[28px] shrink-0">{c.daysToExp}d</span>
              <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/4">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: 'var(--nexus-accent)', opacity: 0.7 }} />
              </div>
              <span className="text-[9px] font-mono text-white/55 w-[56px] shrink-0 text-right">
                OI {c.totalOI.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── CorrelationWidget ─────────────────────────────────────────────────────
// Rolling 30-day realized correlation between BTC and ETH daily returns.
// Reuses priceCloseSeries from fetchDeribitHistory (no separate fetch).

function dailyReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return r;
}

function rollingCorr(x: number[], y: number[], win: number): number[] {
  const n = Math.min(x.length, y.length);
  return Array.from({ length: n }, (_, i) => {
    if (i < win - 1) return NaN;
    const xs = x.slice(i - win + 1, i + 1);
    const ys = y.slice(i - win + 1, i + 1);
    const mx = xs.reduce((a, b) => a + b, 0) / win;
    const my = ys.reduce((a, b) => a + b, 0) / win;
    let cov = 0, vx = 0, vy = 0;
    for (let j = 0; j < win; j++) {
      const dx = xs[j] - mx; const dy = ys[j] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    const d = Math.sqrt(vx * vy);
    return d > 0 ? cov / d : 0;
  });
}

export const CorrelationWidget = () => {
  // Reuse the shared history poller — priceCloseSeries is now included in HistoryData
  const { btc, eth, timedOut } = useDualHistory();

  const corrSeries = useMemo(() => {
    if (!btc?.priceCloseSeries?.length || !eth?.priceCloseSeries?.length) return [];
    const rBTC = dailyReturns(btc.priceCloseSeries);
    const rETH = dailyReturns(eth.priceCloseSeries);
    return rollingCorr(rBTC, rETH, 30).filter(v => !isNaN(v));
  }, [btc, eth]);

  const current = corrSeries.length > 0 ? corrSeries[corrSeries.length - 1] : null;
  const loading = !btc || !eth;

  if (loading) return timedOut ? <HistLoadErr /> : <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const W = 800; const H = 100;
  const lo = -1; const hi = 1;
  const pts = mapPts(corrSeries, W, H, lo, hi);
  const corrColor = (v: number) => v > 0.7 ? 'var(--nexus-accent)' : v > 0.4 ? '#FEBC2E' : v > 0 ? '#6e6e6e' : 'var(--nexus-red)';
  const cur = current ?? 0;
  const regime = cur > 0.8 ? '高度同步' : cur > 0.6 ? '较强同步' : cur > 0.4 ? '中等相关' : cur > 0.2 ? '弱相关' : '背离走势';

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      {/* Header */}
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[10px] text-white/55">BTC / ETH 已实现相关系数（30日滚动）</span>
        <span className="text-[18px] font-mono font-bold tnum ml-auto" style={{ color: corrColor(cur) }}>
          {cur.toFixed(3)}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${corrColor(cur)}20`, color: corrColor(cur) }}>
          {regime}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
          {/* Reference lines */}
          {[0.8, 0.6, 0, -0.6].map(v => {
            const y = H - ((v - lo) / (hi - lo)) * H;
            return <line key={v} x1="0" y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray={v === 0 ? '4,4' : '2,6'} />;
          })}
          {/* Area fill */}
          <path d={area(pts, H)} fill={`${corrColor(cur)}18`} />
          {/* Line */}
          <path d={smooth(pts)} fill="none" stroke={corrColor(cur)} strokeWidth="1.8" />
          {/* Current dot */}
          {pts.length > 0 && (
            <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={corrColor(cur)} />
          )}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-1 shrink-0">
        <span className="text-[9px] text-white/55">← 90天前</span>
        <span className="text-[9px] text-white/55">今日 →</span>
      </div>
    </div>
  );
};

// ── WatchlistWidget ───────────────────────────────────────────────────────
// User-defined instrument watchlist with live ticker data.
function loadWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem('ww_watchlist');
    return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
  } catch { return new Set<string>(); }
}
function saveWatchlist(): void {
  try { localStorage.setItem('ww_watchlist', JSON.stringify([...WATCHLIST_SET])); } catch { /* ignore */ }
}
const WATCHLIST_SET = loadWatchlist();  // persisted across sessions via localStorage
interface WatchItem {
  instrument: string; bid: number; ask: number;
  iv: number; delta: number; mark: number;
  oi: number; oiDelta: number; ts: number;
}
const WATCH_OI_SNAP = new Map<string, number>();
const WATCH_CACHE2  = new Map<string, WatchItem>();

export const WatchlistWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  // watchlist as React state so re-subscriptions fire on add/remove
  const [watchlist, setWatchlist] = useState<string[]>(() => [...WATCHLIST_SET]);
  const [items, setItems] = useState<WatchItem[]>(() =>
    [...WATCHLIST_SET].map(inst => WATCH_CACHE2.get(inst)).filter(Boolean) as WatchItem[]
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  // Subscribe to ticker WS for each instrument; re-runs whenever watchlist changes.
  // WS callbacks write to WATCH_CACHE2 (no React state); a 500ms flush interval
  // batches all N per-instrument updates into a single setItems call.
  const watchlistDirtyRef = useRef(false);
  useEffect(() => {
    if (watchlist.length === 0) { setItems([]); return; }
    watchlistDirtyRef.current = false;
    const unsubs = watchlist.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.raw`, (d) => {
        const oi: number = d.open_interest ?? 0;
        if (!WATCH_OI_SNAP.has(inst)) WATCH_OI_SNAP.set(inst, oi);
        WATCH_CACHE2.set(inst, {
          instrument: inst, bid: d.best_bid_price ?? 0, ask: d.best_ask_price ?? 0,
          iv: d.mark_iv ?? 0, delta: d.greeks?.delta ?? 0, mark: d.mark_price ?? 0,
          oi, oiDelta: oi - (WATCH_OI_SNAP.get(inst) ?? oi), ts: Date.now(),
        });
        watchlistDirtyRef.current = true;
      })
    );
    // Flush all pending WS updates at most every 500ms → single re-render
    const flush = setInterval(() => {
      if (!watchlistDirtyRef.current) return;
      watchlistDirtyRef.current = false;
      setItems(watchlist.map(w => WATCH_CACHE2.get(w)).filter(Boolean) as WatchItem[]);
    }, WS_FLUSH_MS);
    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, [watchlist]);

  const addInstrument = async () => {
    const inst = input.trim().toUpperCase();
    if (!inst || WATCHLIST_SET.has(inst)) return;
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      if (!res.result) { setError('合约不存在'); return; }
      WATCHLIST_SET.add(inst); saveWatchlist();
      setWatchlist([...WATCHLIST_SET]);
      setInput(''); setError('');
    } catch { setError('验证失败'); }
  };

  const removeInstrument = (inst: string) => {
    WATCHLIST_SET.delete(inst); saveWatchlist();
    WATCH_CACHE2.delete(inst);
    setWatchlist([...WATCHLIST_SET]);
    setItems(prev => prev.filter(i => i.instrument !== inst));
  };

  // Suggest instruments from current coin
  const placeholder = coin === 'BTC' ? 'e.g. BTC-27JUN25-100000-C' : 'e.g. ETH-27JUN25-3000-C';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Add input */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 shrink-0 border-b border-white/6">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && addInstrument()}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[10px] font-mono text-white/85 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-white/55"
        />
        <button onClick={addInstrument}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-white/80 hover:bg-white/8 transition-colors">
          + 添加
        </button>
        {error && <span className="text-[9px] text-[var(--nexus-red)]">{error}</span>}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">
          输入合约代码并回车添加…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          {/* Column header */}
          <div className="grid px-3 py-1 text-[9px] text-white/55 uppercase tracking-wider border-b border-white/4"
            style={{ gridTemplateColumns: '1fr 56px 56px 44px 44px 50px 50px 24px' }}>
            <span>合约</span><span className="text-right">Bid</span><span className="text-right">Ask</span>
            <span className="text-right">IV</span><span className="text-right">Δ</span>
            <span className="text-right">OI</span><span className="text-right">OIΔ</span><span />
          </div>
          {items.map(item => {
            const oiColor = item.oiDelta > 0 ? 'var(--nexus-green)' : item.oiDelta < 0 ? 'var(--nexus-red)' : '#6e6e6e';
            return (
              <div key={item.instrument}
                className="grid items-center px-3 py-1.5 border-b border-white/4 hover:bg-white/2 transition-colors"
                style={{ gridTemplateColumns: '1fr 56px 56px 44px 44px 50px 50px 24px' }}>
                <span className="text-[9px] font-mono text-white/80 truncate">{item.instrument}</span>
                <span className="text-right text-[9px] font-mono text-white/65">{item.bid.toFixed(4)}</span>
                <span className="text-right text-[9px] font-mono text-white/65">{item.ask.toFixed(4)}</span>
                <span className="text-right text-[9px] font-mono text-white/85">{item.iv.toFixed(1)}%</span>
                <span className="text-right text-[9px] font-mono"
                  style={{ color: item.delta > 0 ? 'var(--nexus-green)' : 'var(--nexus-red)' }}>
                  {item.delta.toFixed(2)}
                </span>
                <span className="text-right text-[9px] font-mono text-white/65">{item.oi.toFixed(0)}</span>
                <span className="text-right text-[9px] font-mono font-bold" style={{ color: oiColor }}>
                  {item.oiDelta > 0 ? '+' : ''}{item.oiDelta.toFixed(0)}
                </span>
                <button onClick={() => removeInstrument(item.instrument)}
                  className="text-[9px] text-white/55 hover:text-[var(--nexus-red)] transition-colors text-right">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── RollCostWidget ────────────────────────────────────────────────────────
// Roll cost from near expiry to far expiry for ATM straddles.
// Shows: near straddle price, far straddle price, roll debit/credit in USD and vol pts.
export const RollCostWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const S = ddata.spot;
  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>;

  // Compute ATM straddle for each expiry
  const straddlePrices = exps.map(exp => {
    const allStrikes = [...exp.calls.map(c => c.strike), ...exp.puts.map(p => p.strike)];
    if (!allStrikes.length) return { exp, K: S, priceUSD: 0, pricePct: 0 };
    const K = allStrikes.reduce((best, s) => Math.abs(s - S) < Math.abs(best - S) ? s : best, allStrikes[0]);
    const T = Math.max(exp.daysToExp / 365, 0.001);
    const iv = exp.atmIV / 100;
    const priceCoins = bsCall(S, K, T, iv) + bsPut(S, K, T, iv); // in USD (r=q=0 → priceCoins is in same units as S)
    return { exp, K, priceUSD: priceCoins, pricePct: priceCoins / S * 100 };
  });

  interface RollRow { from: string; to: string; nearPriceUSD: number; farPriceUSD: number; rollUSD: number; rollVolPt: number }
  const rows: RollRow[] = [];
  for (let i = 0; i < straddlePrices.length - 1; i++) {
    const n = straddlePrices[i]; const f = straddlePrices[i + 1];
    rows.push({
      from: n.exp.label, to: f.exp.label,
      nearPriceUSD: n.priceUSD, farPriceUSD: f.priceUSD,
      rollUSD: f.priceUSD - n.priceUSD,
      rollVolPt: f.exp.atmIV - n.exp.atmIV,
    });
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-white/55">
        ATM Straddle 展期成本（近 → 远）· 正=需要支付溢价
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[9px] text-white/55 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal">近端</th>
              <th className="text-left pb-1.5 font-normal">远端</th>
              <th className="text-right pb-1.5 font-normal">近端价格</th>
              <th className="text-right pb-1.5 font-normal">远端价格</th>
              <th className="text-right pb-1.5 font-normal">展期成本</th>
              <th className="text-right pb-1.5 font-normal">Δvol</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const rollColor = r.rollUSD > 0 ? 'var(--nexus-red)' : 'var(--nexus-green)';
              return (
                <tr key={`${r.from}-${r.to}`} className="border-t border-white/4">
                  <td className="py-1.5 text-white/65 text-[9px]">{r.from}</td>
                  <td className="py-1.5 text-white/65 text-[9px]">{r.to}</td>
                  <td className="py-1.5 text-right text-white/80">${r.nearPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right text-white/80">${r.farPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: rollColor }}>
                    {r.rollUSD >= 0 ? '+' : ''}${r.rollUSD.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right" style={{ color: r.rollVolPt >= 0 ? '#6e6e6e' : 'var(--nexus-green)' }}>
                    {r.rollVolPt >= 0 ? '+' : ''}{r.rollVolPt.toFixed(1)}vp
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── SentimentCompositeWidget ──────────────────────────────────────────────
// 6-factor composite sentiment score (0 = extreme bear, 100 = extreme bull).
// Factors: PCR · 25δ Skew · IV Rank · Funding · Fear & Greed · DVOL change
interface SentFactor { label: string; score: number; raw: string; weight: number }

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

async function computeSentiment(coin: Coin): Promise<{ composite: number; factors: SentFactor[] }> {
  const [opt, hist, flow] = await Promise.all([
    fetchDeribitOptions(coin),
    fetchDeribitHistory(coin),
    fetchFlowData(coin),
  ]);

  // ① PCR: high = bearish. Map [2.0 → 0, 0.5 → 1]
  const pcrScore   = clamp01((2.0 - opt.pcr) / 1.5);

  // ② 25δ RR (nearest expiry): positive RR = calls bid = bullish. Map [-10 → 0, +10 → 1]
  const rr25 = opt.expiries.find(e => e.daysToExp >= 1)?.rr25 ?? 0;
  const skewScore  = clamp01((rr25 + 10) / 20);

  // ③ IV Rank (52wk): high = fear = bearish. Invert.
  const ivrScore   = clamp01(1 - hist.ivRankCurrent / 100);

  // ④ Funding annualised: positive = longs paying = bullish (crowded long). Map [-100 → 0, +100 → 1]
  const fundScore  = clamp01((flow.annFunding + 100) / 200);

  // ⑤ Fear & Greed 0-100 directly (high = greedy = bullish)
  const fgScore    = clamp01(flow.currentFG / 100);

  // ⑥ DVOL 24h change: use real-time opt.dvol30 vs yesterday's daily close from dvolSeries
  //    (hist.dvolChange24h only reflects yesterday-vs-day-before, up to 24h stale)
  const realtimeDvol   = opt.dvol30;
  const yesterdayDvol  = hist.dvolSeries.length > 0
    ? hist.dvolSeries[hist.dvolSeries.length - 1]
    : realtimeDvol;
  const dvolChangeLive = realtimeDvol - yesterdayDvol;
  const dvolScore      = clamp01((-dvolChangeLive + 10) / 20);

  const factors: SentFactor[] = [
    { label: 'PCR',      score: pcrScore  * 100, raw: opt.pcr.toFixed(2),            weight: 2 },
    { label: 'Skew 25δ', score: skewScore * 100, raw: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(1)}vp`, weight: 2 },
    { label: 'IV Rank',  score: ivrScore  * 100, raw: `${hist.ivRankCurrent.toFixed(0)}%ile`,  weight: 1.5 },
    { label: '资金费率',  score: fundScore * 100, raw: `${flow.annFunding >= 0 ? '+' : ''}${flow.annFunding.toFixed(1)}%`, weight: 1.5 },
    { label: 'FG指数',   score: fgScore   * 100, raw: `${flow.currentFG} ${flow.currentFGLabel}`, weight: 1 },
    { label: 'DVOL Δ',   score: dvolScore * 100, raw: `${dvolChangeLive >= 0 ? '+' : ''}${dvolChangeLive.toFixed(1)}%`, weight: 1 },
  ];

  const totalW  = factors.reduce((s, f) => s + f.weight, 0);
  const composite = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalW;
  return { composite, factors };
}

export const SentimentCompositeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [result, setResult] = useState<{ composite: number; factors: SentFactor[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<{ composite: number; factors: SentFactor[] }>(
      `sentiment-${coin}`,
      () => computeSentiment(coin),
      30_000,
      r => { if (alive) { setResult(r); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading || !result) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const { composite, factors } = result;
  const label  = composite >= 70 ? '极度乐观' : composite >= 55 ? '偏多'   : composite >= 45 ? '中性' : composite >= 30 ? '偏空' : '极度悲观';
  const color  = composite >= 70 ? '#28C840'  : composite >= 55 ? '#28C840' : composite >= 45 ? '#9a9a9a' : composite >= 30 ? '#FF5F57' : '#FF5F57';

  // SVG arc gauge (180°)
  const R = 56; const CX = 80; const CY = 72;
  const toRad = (deg: number) => (deg - 180) * Math.PI / 180;
  const arcX  = (deg: number) => CX + R * Math.cos(toRad(deg));
  const arcY  = (deg: number) => CY + R * Math.sin(toRad(deg));
  const pctDeg = composite / 100 * 180; // 0° → leftmost, 180° → rightmost
  const needleAngle = pctDeg; // degrees from 0=left to 180=right along top arc

  const trackPath = `M ${arcX(0)} ${arcY(0)} A ${R} ${R} 0 0 1 ${arcX(180)} ${arcY(180)}`;
  const fillPath  = pctDeg > 0
    ? `M ${arcX(0)} ${arcY(0)} A ${R} ${R} 0 ${pctDeg > 90 ? 1 : 0} 1 ${arcX(pctDeg)} ${arcY(pctDeg)}`
    : '';
  const nx = CX + (R - 6) * Math.cos(toRad(needleAngle));
  const ny = CY + (R - 6) * Math.sin(toRad(needleAngle));

  const factorColor = (s: number) =>
    s >= 65 ? '#28C840' : s >= 45 ? '#9a9a9a' : '#FF5F57';

  return (
    <div className="w-full h-full flex items-center gap-6 px-4">
      {/* Gauge */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 160 }}>
        <svg viewBox="0 0 160 90" width="160" height="90">
          {/* Track */}
          <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
          {/* Fill */}
          {fillPath && (
            <path d={fillPath} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
          )}
          {/* Needle */}
          <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="4" fill={color} />
          {/* Labels */}
          <text x="18" y="86" fill="#6e6e6e" fontSize="8" textAnchor="middle">熊</text>
          <text x="142" y="86" fill="#6e6e6e" fontSize="8" textAnchor="middle">牛</text>
          {/* Score */}
          <text x={CX} y={CY - 10} fill={color} fontSize="20" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
            {composite.toFixed(0)}
          </text>
          <text x={CX} y={CY + 4} fill={color} fontSize="9" textAnchor="middle">{label}</text>
        </svg>
      </div>

      {/* Factor pills */}
      <div className="flex-1 grid grid-cols-3 gap-2">
        {factors.map(f => (
          <div key={f.label}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg border"
            style={{ borderColor: `${factorColor(f.score)}30`, background: `${factorColor(f.score)}0a` }}>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[9px] text-white/55 uppercase tracking-wider">{f.label}</span>
              <span className="text-[10px] font-mono font-bold tnum" style={{ color: factorColor(f.score) }}>
                {f.raw}
              </span>
            </div>
            {/* Mini bar */}
            <div className="w-[32px] h-[4px] rounded-full overflow-hidden bg-white/6 shrink-0">
              <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: factorColor(f.score) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── OrderbookDepthWidget ──────────────────────────────────────────────────
// Live order-book depth for BTC-PERPETUAL / ETH-PERPETUAL via WS (useOrderbookWS).
// Bids (green) mirrored against asks (red), cumulative depth bars.

export const OrderbookDepthWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const ob = useOrderbookWS(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (!ob) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const ROWS = Math.min(ob.bids.length, ob.asks.length, 12);
  // Cumulative sizes for bar width normalisation
  let cumBid = 0; let cumAsk = 0;
  const bidRows = ob.bids.slice(0, ROWS).map(([p, s]) => { cumBid += s; return { p, s, cum: cumBid }; });
  const askRows = ob.asks.slice(0, ROWS).map(([p, s]) => { cumAsk += s; return { p, s, cum: cumAsk }; });
  const maxCum = Math.max(cumBid, cumAsk, 1);
  const fmtPrice = (p: number) => p >= 10000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(2);
  const fmtSize  = (s: number) => s >= 1000 ? `${(s / 1000).toFixed(1)}K` : s.toFixed(1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header: mark price + spread */}
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0 border-b border-white/6">
        <span className="text-[10px] font-mono text-white/65">
          Mark <span className="text-white/85 font-bold">{fmtPrice(ob.mark)}</span>
        </span>
        <span className="text-[9px] font-mono text-white/55">
          Spread {fmtPrice(ob.spread)} ({ob.mark > 0 ? (ob.spread / ob.mark * 100).toFixed(3) : '—'}%)
        </span>
      </div>
      {/* Column labels */}
      <div className="grid px-3 py-0.5 shrink-0" style={{ gridTemplateColumns: '1fr 60px 8px 60px 1fr' }}>
        <span className="text-[9px] text-white/55 text-left">深度</span>
        <span className="text-[9px] text-white/55 text-right">买价</span>
        <span />
        <span className="text-[9px] text-white/55 text-left">卖价</span>
        <span className="text-[9px] text-white/55 text-right">深度</span>
      </div>
      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-start px-3 pb-1 gap-[1px]">
        {Array.from({ length: ROWS }, (_, i) => {
          const bid = bidRows[i]; const ask = askRows[i];
          const bBarW = bid ? (bid.cum / maxCum) * 100 : 0;
          const aBarW = ask ? (ask.cum / maxCum) * 100 : 0;
          return (
            <div key={i} className="grid items-center" style={{ gridTemplateColumns: '1fr 60px 8px 60px 1fr', height: 18 }}>
              {/* Bid depth bar (right-aligned) */}
              <div className="relative h-[10px] rounded-sm overflow-hidden bg-transparent">
                <div className="absolute right-0 top-0 h-full rounded-sm"
                  style={{ width: `${bBarW}%`, background: 'rgba(37,167,80,0.25)' }} />
                {bid && <span className="absolute left-0 text-[9px] font-mono text-white/55">{fmtSize(bid.s)}</span>}
              </div>
              {/* Bid price */}
              {bid
                ? <span className="text-[10px] font-mono font-bold tnum text-right" style={{ color: 'var(--nexus-green)' }}>{fmtPrice(bid.p)}</span>
                : <span />}
              <span />
              {/* Ask price */}
              {ask
                ? <span className="text-[10px] font-mono font-bold tnum text-left" style={{ color: 'var(--nexus-red)' }}>{fmtPrice(ask.p)}</span>
                : <span />}
              {/* Ask depth bar (left-aligned) */}
              <div className="relative h-[10px] rounded-sm overflow-hidden bg-transparent">
                <div className="absolute left-0 top-0 h-full rounded-sm"
                  style={{ width: `${aBarW}%`, background: 'rgba(244,63,94,0.25)' }} />
                {ask && <span className="absolute right-0 text-[9px] font-mono text-white/55">{fmtSize(ask.s)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── PositionTrackerWidget ─────────────────────────────────────────────────
// User-defined option positions with live Greeks aggregation and P&L estimates.
interface UserPosition {
  id: string;
  instrument: string;
  qty: number;        // positive = long, negative = short
}
interface LivePosition extends UserPosition {
  mark: number; iv: number;
  delta: number; gamma: number; vega: number; theta: number;
  dollarDelta: number; dollarGamma: number; dollarVega: number; dollarTheta: number;
  spot: number; error?: string;
}
function loadPositions(): UserPosition[] {
  try {
    const raw = localStorage.getItem('ww_positions');
    return raw ? (JSON.parse(raw) as UserPosition[]) : [];
  } catch { return []; }
}
function savePositions(): void {
  try { localStorage.setItem('ww_positions', JSON.stringify(POS_STORE)); } catch { /* ignore */ }
}
const POS_STORE: UserPosition[] = loadPositions();  // persisted across sessions via localStorage
// Cache latest WS ticker data per instrument (shared across re-renders)
const POS_TICKER_CACHE = new Map<string, any>();

/** Build LivePosition[] from current positions + cached WS ticker data */
function buildLiveFromCache(positions: UserPosition[]): LivePosition[] {
  return positions.map(pos => {
    const t = POS_TICKER_CACHE.get(pos.instrument);
    if (!t) return { ...pos, mark: 0, iv: 0, delta: 0, gamma: 0, vega: 0, theta: 0,
                     dollarDelta: 0, dollarGamma: 0, dollarVega: 0, dollarTheta: 0, spot: 0 };
    const spot: number = t.underlying_price ?? t.index_price ?? 1;
    const g = t.greeks ?? {};
    const delta: number = (g.delta ?? 0) * pos.qty;
    const gamma: number = (g.gamma ?? 0) * pos.qty;
    const vega:  number = (g.vega  ?? 0) * pos.qty;
    const theta: number = (g.theta ?? 0) * pos.qty;
    return { ...pos, mark: t.mark_price ?? 0, iv: t.mark_iv ?? 0,
             delta, gamma, vega, theta,
             dollarDelta: delta * spot, dollarGamma: gamma * spot * spot / 100,
             dollarVega: vega / 100, dollarTheta: theta * spot, spot };
  });
}

export const PositionTrackerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [positions, setPositions] = useState<UserPosition[]>([...POS_STORE]);
  const [live, setLive] = useState<LivePosition[]>(() => buildLiveFromCache([...POS_STORE]));
  const [input, setInput] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  // Subscribe to ticker WS for each unique instrument; re-runs when positions change.
  // Callbacks write to POS_TICKER_CACHE; a 500ms interval flushes to React state.
  const posDirtyRef = useRef(false);
  useEffect(() => {
    if (positions.length === 0) { setLive([]); return; }
    posDirtyRef.current = false;
    const instruments = Array.from(new Set<string>(positions.map(p => p.instrument)));
    const unsubs = instruments.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.raw`, (d) => {
        POS_TICKER_CACHE.set(inst, d);
        posDirtyRef.current = true;
      })
    );
    const flush = setInterval(() => {
      if (!posDirtyRef.current) return;
      posDirtyRef.current = false;
      setLive(buildLiveFromCache(positions));
    }, WS_FLUSH_MS);
    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, [positions]);

  const addPosition = async () => {
    const inst = input.trim().toUpperCase();
    const qty  = parseFloat(qtyInput);
    if (!inst || isNaN(qty) || qty === 0) { setAddError('请输入合约和数量'); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      if (!res.result) { setAddError('合约不存在'); setLoading(false); return; }
      const newPos: UserPosition = { id: `${inst}-${Date.now()}`, instrument: inst, qty };
      POS_STORE.push(newPos); savePositions();
      setPositions([...POS_STORE]);
      setInput(''); setQtyInput('1'); setAddError('');
    } catch { setAddError('验证失败'); }
    setLoading(false);
  };

  const removePosition = (id: string) => {
    const idx = POS_STORE.findIndex(p => p.id === id);
    if (idx >= 0) { POS_STORE.splice(idx, 1); savePositions(); }
    setPositions([...POS_STORE]);
  };

  // Aggregate Greeks
  const netDelta  = live.reduce((s, p) => s + p.dollarDelta, 0);
  const netGamma  = live.reduce((s, p) => s + p.dollarGamma, 0);
  const netVega   = live.reduce((s, p) => s + p.dollarVega,  0);
  const netTheta  = live.reduce((s, p) => s + p.dollarTheta, 0);

  // P&L estimates for ±5% spot moves using delta + gamma approximation
  const spotForPnL = live[0]?.spot ?? 0;
  const pnlUp5   = netDelta * 0.05 + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;
  const pnlDn5   = netDelta * (-0.05) + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;

  const fmtK = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}`;
  const gColor = (v: number) => v > 0 ? 'var(--nexus-green)' : v < 0 ? 'var(--nexus-red)' : '#6e6e6e';

  const placeholder = coin === 'BTC' ? 'BTC-27JUN25-100000-C' : 'ETH-27JUN25-3000-P';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Add row */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 shrink-0 border-b border-white/6">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setAddError(''); }}
          onKeyDown={e => e.key === 'Enter' && addPosition()}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[10px] font-mono text-white/85 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-white/55"
        />
        <input
          value={qtyInput}
          onChange={e => setQtyInput(e.target.value)}
          placeholder="qty"
          className="w-[52px] bg-transparent text-[10px] font-mono text-center text-white/85 border border-white/10 rounded px-1 py-1 outline-none focus:border-white/30"
        />
        <button onClick={addPosition} disabled={loading}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-white/80 hover:bg-white/8 transition-colors disabled:opacity-40">
          + 加仓
        </button>
        {addError && <span className="text-[9px] text-[var(--nexus-red)]">{addError}</span>}
      </div>

      {/* Aggregate Greeks bar */}
      {live.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-1.5 shrink-0 border-b border-white/6 bg-white/2">
          {[
            { label: '$Δ', val: netDelta, title: '净美元Delta' },
            { label: '$Γ/1%', val: netGamma, title: '净Dollar Gamma per 1% spot' },
            { label: '$ν/1%', val: netVega, title: '净Dollar Vega per 1% IV' },
            { label: '$Θ/d', val: netTheta, title: '净Dollar Theta per day' },
          ].map(g => (
            <div key={g.label} className="flex flex-col items-center" title={g.title}>
              <span className="text-[9px] text-white/55">{g.label}</span>
              <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(g.val) }}>
                {fmtK(g.val)}
              </span>
            </div>
          ))}
          <div className="h-8 w-px bg-white/8 mx-1" />
          <div className="flex flex-col items-center" title="Spot +5% P&L估算">
            <span className="text-[9px] text-white/55">+5% P&L</span>
            <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(pnlUp5) }}>{fmtK(pnlUp5)}</span>
          </div>
          <div className="flex flex-col items-center" title="Spot -5% P&L估算">
            <span className="text-[9px] text-white/55">-5% P&L</span>
            <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(pnlDn5) }}>{fmtK(pnlDn5)}</span>
          </div>
        </div>
      )}

      {/* Position rows */}
      {positions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">
          输入合约代码和数量（负数=做空）…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          <div className="grid px-3 py-1 text-[9px] text-white/55 uppercase tracking-wider border-b border-white/4"
            style={{ gridTemplateColumns: '1fr 40px 52px 44px 44px 44px 44px 20px' }}>
            <span>合约</span><span className="text-right">数量</span><span className="text-right">Mark</span>
            <span className="text-right">$Δ</span><span className="text-right">$Γ</span>
            <span className="text-right">$ν</span><span className="text-right">$Θ</span><span />
          </div>
          {live.map(p => (
            <div key={p.id}
              className="grid items-center px-3 py-1.5 border-b border-white/4 hover:bg-white/2 transition-colors"
              style={{ gridTemplateColumns: '1fr 40px 52px 44px 44px 44px 44px 20px' }}>
              <span className="text-[9px] font-mono text-white/80 truncate" title={p.instrument}>{p.instrument}</span>
              <span className="text-right text-[9px] font-mono"
                style={{ color: p.qty > 0 ? 'var(--nexus-green)' : 'var(--nexus-red)' }}>
                {p.qty > 0 ? '+' : ''}{p.qty}
              </span>
              <span className="text-right text-[9px] font-mono text-white/80">
                {p.error ? <span className="text-[var(--nexus-red)] text-[9px]">{p.error}</span> : p.mark.toFixed(4)}
              </span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarDelta) }}>{fmtK(p.dollarDelta)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarGamma) }}>{fmtK(p.dollarGamma)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarVega)  }}>{fmtK(p.dollarVega)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarTheta) }}>{fmtK(p.dollarTheta)}</span>
              <button onClick={() => removePosition(p.id)}
                className="text-[9px] text-white/55 hover:text-[var(--nexus-red)] transition-colors text-right">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// ALERTS SYSTEM
// ══════════════════════════════════════════════════════════════════════════
type AlertMetric = 'spot' | 'dvol' | 'ivrank' | 'funding' | 'sentiment' | 'callflow' | 'putflow';
type AlertOp     = '>' | '<';

interface UserAlert {
  id: string; coin: Coin; metric: AlertMetric; op: AlertOp;
  threshold: number; active: boolean;
  triggered: boolean; lastValue: number | null; triggeredAt: number | null;
}
function loadAlerts(): UserAlert[] {
  try {
    const raw = localStorage.getItem('ww_alerts');
    if (!raw) return [];
    // Reset runtime state on load (triggered state is session-specific)
    return (JSON.parse(raw) as UserAlert[]).map(a => ({
      ...a, triggered: false, lastValue: null, triggeredAt: null,
    }));
  } catch { return []; }
}
function saveAlerts(): void {
  try {
    // Persist only config fields, not transient trigger state
    const toStore = ALERTS_STORE.map(({ id, coin, metric, op, threshold, active }) =>
      ({ id, coin, metric, op, threshold, active, triggered: false, lastValue: null, triggeredAt: null })
    );
    localStorage.setItem('ww_alerts', JSON.stringify(toStore));
  } catch { /* ignore */ }
}
const ALERTS_STORE: UserAlert[] = loadAlerts();

const METRIC_META: Record<AlertMetric, { label: string; unit: string; defaultVal: number }> = {
  spot:      { label: 'Spot 价格',    unit: '$',    defaultVal: 90000 },
  dvol:      { label: 'DVOL',         unit: '%',    defaultVal: 60    },
  ivrank:    { label: 'IV 百分位',    unit: '%ile', defaultVal: 80    },
  funding:   { label: '年化资金费率', unit: '%',    defaultVal: 50    },
  sentiment: { label: '情绪评分',     unit: 'pts',  defaultVal: 30    },
  callflow:  { label: 'Call 净流向',  unit: 'K$',   defaultVal: 1000  },
  putflow:   { label: 'Put 净流向',   unit: 'K$',   defaultVal: -500  },
};

function evalAlerts(coin: Coin): void {
  const optC  = DERIBIT_CACHE.get(coin);
  const histC = HIST_CACHE.get(coin);
  const flowC = FLOW_CACHE.get(coin);
  const tickC = TICKER_CACHE2.get(coin);
  const pflAc = PFLOW_ACC.get(coin);

  const vals: Partial<Record<AlertMetric, number>> = {};
  if (tickC)  { vals.spot = tickC.data.spot; vals.dvol = tickC.data.dvol; }
  else if (optC) { vals.spot = optC.data.spot; }
  if (histC)  vals.ivrank = histC.data.ivRankCurrent;
  if (flowC)  vals.funding = flowC.data.annFunding;
  if (pflAc)  { vals.callflow = pflAc.cumCallNet / 1000; vals.putflow = pflAc.cumPutNet / 1000; }

  for (const a of ALERTS_STORE) {
    if (!a.active || a.coin !== coin) continue;
    const v = vals[a.metric];
    if (v === undefined) continue;
    a.lastValue = v;
    const prev = a.triggered;
    a.triggered = a.op === '>' ? v > a.threshold : v < a.threshold;
    if (a.triggered && !prev) {
      a.triggeredAt = Date.now();
      // Browser push notification
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const meta = METRIC_META[a.metric];
        new Notification(`${a.coin} 警报触发`, {
          body: `${meta.label} ${a.op} ${a.threshold}${meta.unit}  (当前: ${v.toFixed(2)}${meta.unit})`,
          icon: '/favicon.ico',
          tag: a.id,
        });
      }
    }
  }
}

// ── AlertsWidget ──────────────────────────────────────────────────────────
export const AlertsWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [alerts, setAlerts] = useState<UserAlert[]>([...ALERTS_STORE]);
  const [metric, setMetric] = useState<AlertMetric>('spot');
  const [op, setOp]         = useState<AlertOp>('>');
  const [thresh, setThresh] = useState('');

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  // Request browser notification permission once on mount
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* ignore */ });
    }
  }, []);

  // Evaluate every 10 s using cached data (no forced fetches)
  useEffect(() => {
    let alive = true;
    const tick = () => { evalAlerts(coin); if (alive) setAlerts([...ALERTS_STORE]); };
    tick();
    const stop = setVisibleInterval(tick, 10_000);
    return () => { alive = false; stop(); };
  }, [coin]);

  const addAlert = () => {
    const t = parseFloat(thresh);
    if (isNaN(t)) return;
    ALERTS_STORE.push({
      id: `${Date.now()}`, coin, metric, op, threshold: t,
      active: true, triggered: false, lastValue: null, triggeredAt: null,
    });
    saveAlerts();
    setAlerts([...ALERTS_STORE]);
    setThresh('');
  };

  const removeAlert = (id: string) => {
    const i = ALERTS_STORE.findIndex(a => a.id === id);
    if (i >= 0) { ALERTS_STORE.splice(i, 1); saveAlerts(); }
    setAlerts([...ALERTS_STORE]);
  };

  const toggleAlert = (id: string) => {
    const a = ALERTS_STORE.find(x => x.id === id);
    if (a) { a.active = !a.active; a.triggered = false; saveAlerts(); }
    setAlerts([...ALERTS_STORE]);
  };

  const meta = METRIC_META[metric];

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Add form */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 shrink-0 border-b border-white/6 flex-wrap">
        <select value={metric} onChange={e => { setMetric(e.target.value as AlertMetric); setThresh(String(METRIC_META[e.target.value as AlertMetric].defaultVal)); }}
          className="text-[10px] bg-transparent border border-white/10 rounded px-1.5 py-1 text-white/80 outline-none">
          {(Object.keys(METRIC_META) as AlertMetric[]).map(m => (
            <option key={m} value={m}>{METRIC_META[m].label}</option>
          ))}
        </select>
        <select value={op} onChange={e => setOp(e.target.value as AlertOp)}
          className="w-[44px] text-[10px] bg-transparent border border-white/10 rounded px-1 py-1 text-white/80 outline-none">
          <option value=">">{'>'}</option>
          <option value="<">{'<'}</option>
        </select>
        <input
          value={thresh}
          onChange={e => setThresh(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addAlert()}
          placeholder={`${meta.defaultVal} ${meta.unit}`}
          className="w-[88px] bg-transparent text-[10px] font-mono text-white/85 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-white/55"
        />
        <button onClick={addAlert}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-white/80 hover:bg-white/8 transition-colors">
          + 添加
        </button>
      </div>

      {alerts.filter(a => a.coin === coin).length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">
          暂无警报规则
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 pt-1 flex flex-col gap-1.5">
          {alerts.filter(a => a.coin === coin).map(a => {
            const m = METRIC_META[a.metric];
            const ringColor = a.triggered ? (a.op === '>' ? 'var(--nexus-green)' : 'var(--nexus-red)') : 'transparent';
            const fmtVal = (v: number | null) => v === null ? '—' : a.metric === 'spot' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(1);
            return (
              <div key={a.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: a.triggered ? `${ringColor}60` : 'rgba(255,255,255,0.06)', background: a.triggered ? `${ringColor}0c` : 'transparent' }}>
                {/* Status LED */}
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.active ? (a.triggered ? ringColor : 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.06)' }} />
                {/* Description */}
                <span className="flex-1 text-[10px] font-mono text-white/80">
                  {m.label} {a.op} <span className="font-bold text-white/90">{fmtVal(a.threshold)}</span> {m.unit}
                </span>
                {/* Current value */}
                <span className="text-[10px] font-mono text-white/55">
                  现值 <span style={{ color: a.triggered ? ringColor : '#9a9a9a' }}>{fmtVal(a.lastValue)}</span>
                </span>
                {/* Triggered time */}
                {a.triggeredAt && (
                  <span className="text-[9px] text-white/55">
                    {new Date(a.triggeredAt).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {/* Toggle + remove */}
                <button onClick={() => toggleAlert(a.id)}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-white/8 transition-colors"
                  style={{ color: a.active ? '#9a9a9a' : '#555555' }}>
                  {a.active ? '启用' : '暂停'}
                </button>
                <button onClick={() => removeAlert(a.id)}
                  className="text-[9px] text-white/55 hover:text-[var(--nexus-red)] transition-colors">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── PayoffProfileWidget ───────────────────────────────────────────────────
// Aggregate expiry P&L profile for all positions in POS_STORE.
// X-axis = spot at expiry; Y-axis = total P&L in USD.
function parseInstForPayoff(inst: string): { K: number; type: 'C' | 'P'; expiryLabel: string } | null {
  const parts = inst.split('-');
  if (parts.length !== 4) return null;
  const [, expiryRaw, strikeStr, typeStr] = parts;
  const K = Number(strikeStr);
  if (isNaN(K)) return null;
  return { K, type: typeStr === 'C' ? 'C' : 'P', expiryLabel: expiryRaw };
}

export const PayoffProfileWidget = () => {
  const { setHeaderRight } = useCardHeader();
  const [live, setLive] = useState<LivePosition[]>([]);
  const [posCount, setPosCount] = useState(POS_STORE.length);

  useEffect(() => {
    setHeaderRight(<span className="text-[9px] text-white/55">基于当前 mark 价格，到期日盈亏</span>);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  const payoffDirtyRef = useRef(false);
  useEffect(() => {
    const snap = [...POS_STORE];
    setPosCount(snap.length);
    if (snap.length === 0) { setLive([]); return; }
    setLive(buildLiveFromCache(snap));
    payoffDirtyRef.current = false;
    const instruments = Array.from(new Set<string>(snap.map(p => p.instrument)));
    const unsubs = instruments.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.raw`, (d) => {
        POS_TICKER_CACHE.set(inst, d);
        payoffDirtyRef.current = true;
      })
    );
    const flush = setInterval(() => {
      if (!payoffDirtyRef.current) return;
      payoffDirtyRef.current = false;
      setLive(buildLiveFromCache([...POS_STORE]));
      setPosCount(POS_STORE.length);
    }, WS_FLUSH_MS);
    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, []);

  if (posCount === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">
      请先在「持仓追踪」中添加合约
    </div>
  );

  const spot = live[0]?.spot ?? 0;
  if (!spot || live.length === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">
      加载中…
    </div>
  );

  // Build payoff curve: spot range ±35%, 160 steps
  const STEPS = 160;
  const lo = spot * 0.65; const hi = spot * 1.35;
  const xs = Array.from({ length: STEPS }, (_, i) => lo + (hi - lo) * i / (STEPS - 1));

  // For each position, compute payoff at expiry at each x
  const positions = live.filter(p => !p.error);
  const ys = xs.map(x => {
    return positions.reduce((total, p) => {
      const parsed = parseInstForPayoff(p.instrument);
      if (!parsed) return total;
      const { K, type } = parsed;
      const intrinsic = type === 'C' ? Math.max(x - K, 0) : Math.max(K - x, 0);
      const costUSD   = p.mark * p.spot;          // mark (in coin) × spot → USD per contract
      const pnl       = (intrinsic - costUSD) * p.qty;
      return total + pnl;
    }, 0);
  });

  // Find breakevens (zero crossings)
  const breakevens: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i - 1] * ys[i] < 0) {
      const be = xs[i - 1] + (xs[i] - xs[i - 1]) * Math.abs(ys[i - 1]) / (Math.abs(ys[i - 1]) + Math.abs(ys[i]));
      breakevens.push(be);
    }
  }

  const W = 800; const H = 140;
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pad  = (maxY - minY) * 0.1 || 1;
  const yLo  = minY - pad; const yHi = maxY + pad;

  const toSvgX = (x: number) => ((x - lo) / (hi - lo)) * W;
  const toSvgY = (y: number) => H - ((y - yLo) / (yHi - yLo)) * H;
  const zero   = toSvgY(0);
  const spotX  = toSvgX(spot);

  // Build two path segments: profit (above zero) and loss (below zero)
  const pts: [number, number][] = xs.map((x, i) => [toSvgX(x), toSvgY(ys[i])]);
  const pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaAbove = `${pathD} L${W},${zero} L0,${zero} Z`;
  const areaBelow = `${pathD} L${W},${zero} L0,${zero} Z`;

  const maxLoss   = Math.min(...ys);
  const maxProfit = Math.max(...ys);

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      {/* Stats row */}
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[9px] text-white/55">{positions.length} 个持仓</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-green)' }}>
          最大盈利 ${maxProfit >= 1000 ? (maxProfit / 1000).toFixed(1) + 'K' : maxProfit.toFixed(0)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-red)' }}>
          最大亏损 ${Math.abs(maxLoss) >= 1000 ? (maxLoss / 1000).toFixed(1) + 'K' : maxLoss.toFixed(0)}
        </span>
        {breakevens.map((be, i) => (
          <span key={i} className="text-[10px] font-mono text-white/65">
            BE{i + 1} {be >= 10000 ? be.toLocaleString('en-US', { maximumFractionDigits: 0 }) : be.toFixed(1)}
          </span>
        ))}
      </div>
      {/* Chart */}
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
          {/* Zero line */}
          <line x1="0" y1={zero} x2={W} y2={zero} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4,4" />
          {/* Profit fill */}
          <clipPath id="profitClip"><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <path d={areaAbove} fill="rgba(37,167,80,0.18)" clipPath="url(#profitClip)" />
          {/* Loss fill */}
          <clipPath id="lossClip"><rect x="0" y={zero} width={W} height={H - zero} /></clipPath>
          <path d={areaBelow} fill="rgba(244,63,94,0.18)" clipPath="url(#lossClip)" />
          {/* P&L line */}
          <path d={pathD} fill="none" stroke="var(--nexus-accent)" strokeWidth="2" />
          {/* Current spot vertical */}
          <line x1={spotX} y1="0" x2={spotX} y2={H} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="3,3" />
          {/* Breakeven markers */}
          {breakevens.map((be, i) => (
            <line key={i} x1={toSvgX(be)} y1="0" x2={toSvgX(be)} y2={H}
              stroke="rgba(251,191,36,0.5)" strokeWidth="1" strokeDasharray="2,4" />
          ))}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-0.5 shrink-0">
        <span className="text-[9px] text-white/55">${(lo / 1000).toFixed(0)}K</span>
        <span className="text-[9px] text-white/55">当前 Spot {spot >= 10000 ? spot.toLocaleString('en-US', { maximumFractionDigits: 0 }) : spot.toFixed(1)}</span>
        <span className="text-[9px] text-white/55">${(hi / 1000).toFixed(0)}K</span>
      </div>
    </div>
  );
};

// ── IVCheapnessWidget ─────────────────────────────────────────────────────
// Per-tenor matrix: current IV · IV %ile vs historical RV cone · VRP → cheap/fair/expensive.
const CONE_TENORS = [7, 14, 30, 60, 90, 180];

export const IVCheapnessWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [opt, setOpt]     = useState<DeribitData | null>(null);
  const [hist, setHist]   = useState<HistoryData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [timedOut, setTimedOut]   = useState(false);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    let gotOpt = false;
    let gotHist = false;
    setLoading(true);
    setTimedOut(false);
    const timeout = setTimeout(() => { if (alive && (!opt || !hist)) setTimedOut(true); }, 20_000);
    const u1 = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (!alive) return; setOpt(d); gotOpt = true; if (gotHist) setLoading(false); },
    );
    const u2 = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => { if (!alive) return; setHist(d); gotHist = true; setTimedOut(false); if (gotOpt) setLoading(false); },
    );
    return () => { alive = false; clearTimeout(timeout); u1(); u2(); };
  }, [coin]);

  if (loading || !opt || !hist) return timedOut
    ? <HistLoadErr />
    : <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const cone = hist.volCone;
  const rvByTenor = hist.rvByTenor; // [7,14,30,60,90,180,365]D RV

  // Interpolate current IV to fixed tenors from expiries
  function interpIV(targetDays: number): number {
    const sorted = [...opt!.expiries].filter(e => e.daysToExp > 0 && e.atmIV > 0)
      .sort((a, b) => a.daysToExp - b.daysToExp);
    if (!sorted.length) return 0;
    if (targetDays <= sorted[0].daysToExp)  return sorted[0].atmIV;
    if (targetDays >= sorted[sorted.length - 1].daysToExp) return sorted[sorted.length - 1].atmIV;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]; const b = sorted[i + 1];
      if (targetDays >= a.daysToExp && targetDays <= b.daysToExp) {
        const t = (targetDays - a.daysToExp) / (b.daysToExp - a.daysToExp);
        return a.atmIV + t * (b.atmIV - a.atmIV);
      }
    }
    return 0;
  }

  interface RowData {
    tenor: number; label: string;
    iv: number; rv: number; vrp: number;
    p25: number; p50: number; p75: number;
    ivPctile: number;   // IV's position in historical RV cone (0-100)
    verdict: 'cheap' | 'fair' | 'expensive' | 'very-cheap' | 'very-expensive';
  }

  const rows: RowData[] = CONE_TENORS.map((t, i) => {
    const iv  = interpIV(t);
    const rv  = rvByTenor[i] ?? 0;
    const vrp = iv - rv;
    const p25 = cone.p25[i] ?? 0;
    const p50 = cone.p50[i] ?? 0;
    const p75 = cone.p75[i] ?? 0;
    const p10 = cone.p10[i] ?? 0;
    const p90 = cone.p90[i] ?? 0;
    // IV percentile within cone
    const range = p90 - p10 || 1;
    const ivPctile = Math.min(100, Math.max(0, (iv - p10) / range * 100));
    const verdict: RowData['verdict'] =
      iv < p10  ? 'very-cheap'    :
      iv < p25  ? 'cheap'         :
      iv < p75  ? 'fair'          :
      iv < p90  ? 'expensive'     : 'very-expensive';
    return { tenor: t, label: `${t}D`, iv, rv, vrp, p25, p50, p75, ivPctile, verdict };
  }).filter(r => r.iv > 0);

  const verdictStyle = (v: RowData['verdict']) => ({
    'very-cheap':     { bg: 'rgba(37,167,80,0.25)',   text: '#28C840', label: '极便宜' },
    'cheap':          { bg: 'rgba(37,167,80,0.12)',   text: '#28C840', label: '便宜'   },
    'fair':           { bg: 'rgba(255,255,255,0.04)', text: '#9a9a9a', label: '合理'   },
    'expensive':      { bg: 'rgba(244,63,94,0.12)',   text: '#FF5F57', label: '偏贵'   },
    'very-expensive': { bg: 'rgba(244,63,94,0.25)',   text: '#FF5F57', label: '极贵'   },
  }[v]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-white/55">
        当前 IV 对比历史 RV 分位锥 — 颜色=便宜/贵评级，VRP=溢价
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[9px] text-white/55 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal w-[36px]">期限</th>
              <th className="text-right pb-1.5 font-normal">当前IV</th>
              <th className="text-right pb-1.5 font-normal">当前RV</th>
              <th className="text-right pb-1.5 font-normal">VRP</th>
              <th className="pb-1.5 font-normal text-center">IV在锥中位置</th>
              <th className="text-center pb-1.5 font-normal">评级</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const vs = verdictStyle(r.verdict);
              const vrpColor = r.vrp > 3 ? 'var(--nexus-red)' : r.vrp < -3 ? 'var(--nexus-green)' : '#9a9a9a';
              return (
                <tr key={r.tenor} className="border-t border-white/4" style={{ background: vs.bg }}>
                  <td className="py-1.5 text-white/65 font-bold">{r.label}</td>
                  <td className="py-1.5 text-right text-white/85 font-bold">{r.iv.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-white/65">{r.rv.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: vrpColor }}>
                    {r.vrp >= 0 ? '+' : ''}{r.vrp.toFixed(1)}vp
                  </td>
                  {/* Mini cone bar */}
                  <td className="py-1.5 px-3">
                    <div className="relative h-[8px] rounded-full bg-white/6 overflow-hidden">
                      {/* p25-p75 band */}
                      <div className="absolute top-0 h-full rounded-full bg-white/10"
                        style={{ left: `${(r.p25 / (r.p75 + 5)) * 100}%`, width: `${((r.p75 - r.p25) / (r.p75 + 5)) * 100}%` }} />
                      {/* Current IV marker */}
                      <div className="absolute top-0.5 w-[3px] h-[5px] rounded-full"
                        style={{ left: `${r.ivPctile}%`, background: vs.text, transform: 'translateX(-50%)' }} />
                    </div>
                  </td>
                  <td className="py-1.5 text-center">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: vs.text, background: vs.bg }}>
                      {vs.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── VerticalSpreadPricerWidget ────────────────────────────────────────────
// Price bull call / bear put / risk reversal spreads from live option data.
type SpreadType = 'bull-call' | 'bear-put' | 'risk-reversal';

export const VerticalSpreadPricerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata]         = useState<DeribitData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [spreadType, setSpreadType] = useState<SpreadType>('bull-call');
  const [expIdx, setExpIdx]       = useState(0);
  const [buyStrike, setBuyStrike] = useState<number | null>(null);
  const [sellStrike, setSellStrike] = useState<number | null>(null);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (alive) { setDdata(d); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  // Reset strikes when expiry or type changes
  useEffect(() => { setBuyStrike(null); setSellStrike(null); }, [expIdx, spreadType]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">加载中…</div>;

  const S = ddata.spot;
  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (!exps.length) return <div className="w-full h-full flex items-center justify-center text-[11px] text-white/55">暂无数据</div>;

  const safeIdx = Math.min(expIdx, exps.length - 1);
  const exp = exps[safeIdx];
  const T   = Math.max(exp.daysToExp / 365, 0.001);

  // Available strikes
  const callStrikes: number[] = [...new Set<number>(exp.calls.map(c => c.strike))].sort((a, b) => a - b);
  const putStrikes:  number[] = [...new Set<number>(exp.puts.map(p => p.strike))].sort((a, b) => a - b);

  const buyStrikes  = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : callStrikes; // RR: buy call
  const sellStrikes = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : putStrikes; // RR: sell put

  const getIV = (strike: number, type: 'C' | 'P') => {
    const arr = type === 'C' ? exp.calls : exp.puts;
    return arr.find(o => o.strike === strike)?.iv ?? exp.atmIV / 100;
  };

  // Compute spread metrics when both strikes are selected
  let result: {
    buyPrice: number; sellPrice: number; net: number; maxProfit: number; maxLoss: number;
    beLower: number; beUpper: number | null;
    netDelta: number; netGamma: number; netVega: number; netTheta: number;
  } | null = null;

  if (buyStrike !== null && sellStrike !== null && buyStrike !== sellStrike) {
    const buyType:  'C' | 'P' = spreadType === 'bear-put' ? 'P' : 'C';
    const sellType: 'C' | 'P' = spreadType === 'risk-reversal' ? 'P' : buyType;

    const buyIV  = getIV(buyStrike,  buyType);
    const sellIV = getIV(sellStrike, sellType);

    const buyPrice  = (buyType  === 'C' ? bsCall : bsPut)(S, buyStrike,  T, buyIV);
    const sellPrice = (sellType === 'C' ? bsCall : bsPut)(S, sellStrike, T, sellIV);
    const net = buyPrice - sellPrice; // positive = debit, negative = credit

    let maxProfit = 0; let maxLoss = 0;
    let beLower = 0; let beUpper: number | null = null;

    if (spreadType === 'bull-call') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net; // at expiry, both ITM
      maxLoss   = net; // at expiry, both OTM
      beLower   = Math.min(buyStrike, sellStrike) + net;
    } else if (spreadType === 'bear-put') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net;
      maxLoss   = net;
      beLower   = Math.max(buyStrike, sellStrike) - net;
    } else { // risk reversal
      maxProfit = Infinity; // unlimited upside
      maxLoss   = -Infinity; // unlimited downside
      beLower   = buyStrike  + net; // call BE
      beUpper   = sellStrike - net; // put BE (if credit)
    }

    const netDelta = bsDelta(S, buyStrike, T, buyIV, buyType) - bsDelta(S, sellStrike, T, sellIV, sellType);
    const netGamma = bsGamma(S, buyStrike, T, buyIV) - bsGamma(S, sellStrike, T, sellIV);
    const netVega  = bsVega(S, buyStrike, T, buyIV) - bsVega(S, sellStrike, T, sellIV);
    const netTheta = bsTheta(S, buyStrike, T, buyIV) - bsTheta(S, sellStrike, T, sellIV);

    result = { buyPrice, sellPrice, net, maxProfit, maxLoss, beLower, beUpper, netDelta, netGamma, netVega, netTheta };
  }

  const spreadLabels: Record<SpreadType, string> = {
    'bull-call': '牛市价差（买低卖高 Call）',
    'bear-put':  '熊市价差（买高卖低 Put）',
    'risk-reversal': '风险逆转（买 Call 卖 Put）',
  };
  const buyLegLabel  = spreadType === 'bear-put' ? '买 Put' : '买 Call';
  const sellLegLabel = spreadType === 'risk-reversal' ? '卖 Put' : spreadType === 'bear-put' ? '卖 Put' : '卖 Call';

  const fmtUSD = (v: number) => `$${Math.abs(v) >= 1 ? v.toFixed(0) : v.toFixed(2)}`;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Controls */}
      <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 shrink-0 flex-wrap border-b border-white/6">
        {(['bull-call', 'bear-put', 'risk-reversal'] as SpreadType[]).map(t => (
          <button key={t} onClick={() => setSpreadType(t)}
            className="px-2 py-0.5 rounded text-[10px] transition-colors"
            style={{
              background: spreadType === t ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              color: spreadType === t ? 'var(--nexus-accent)' : '#6e6e6e',
              border: `1px solid ${spreadType === t ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
            }}>{spreadLabels[t].split('（')[0]}</button>
        ))}
        <div className="h-4 w-px bg-white/8" />
        {exps.map((e, i) => (
          <button key={e.label} onClick={() => setExpIdx(i)}
            className="px-2 py-0.5 rounded text-[10px] font-mono transition-colors"
            style={{
              background: i === safeIdx ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: i === safeIdx ? '#F0F0EE' : '#555555',
            }}>{e.label}</button>
        ))}
      </div>

      {/* Strike selectors */}
      <div className="flex items-center gap-3 px-3 py-1.5 shrink-0 border-b border-white/6">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/55 w-[44px]">{buyLegLabel}</span>
          <select value={buyStrike ?? ''} onChange={e => setBuyStrike(Number(e.target.value))}
            className="text-[10px] font-mono bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-white/80 outline-none">
            <option value="">选择行权价</option>
            {buyStrikes.map(k => <option key={k} value={k}>{k.toLocaleString()}{k === (buyStrikes as number[]).reduce((b: number, s: number) => Math.abs(s - S) < Math.abs(b - S) ? s : b, buyStrikes[0]) ? ' ★' : ''}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/55 w-[44px]">{sellLegLabel}</span>
          <select value={sellStrike ?? ''} onChange={e => setSellStrike(Number(e.target.value))}
            className="text-[10px] font-mono bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-white/80 outline-none">
            <option value="">选择行权价</option>
            {sellStrikes.map(k => <option key={k} value={k}>{k.toLocaleString()}{k === (sellStrikes as number[]).reduce((b: number, s: number) => Math.abs(s - S) < Math.abs(b - S) ? s : b, sellStrikes[0]) ? ' ★' : ''}</option>)}
          </select>
        </div>
        <span className="text-[9px] text-white/55 ml-auto">★ = 最近ATM</span>
      </div>

      {/* Results */}
      {!result ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/55">
          选择买腿和卖腿行权价
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2 flex flex-col gap-2">
          {/* Cost & payoff */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: result.net >= 0 ? '净付权利金' : '净收权利金', val: fmtUSD(result.net), color: result.net >= 0 ? 'var(--nexus-red)' : 'var(--nexus-green)' },
              { label: '最大盈利', val: isFinite(result.maxProfit) ? fmtUSD(result.maxProfit) : '无限', color: 'var(--nexus-green)' },
              { label: '最大亏损', val: isFinite(result.maxLoss) ? fmtUSD(-result.maxLoss) : '无限', color: 'var(--nexus-red)' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center py-1.5 rounded-lg bg-white/3 border border-white/6">
                <span className="text-[9px] text-white/55 uppercase tracking-wider">{s.label}</span>
                <span className="text-[15px] font-mono font-bold tnum mt-0.5" style={{ color: s.color }}>{s.val}</span>
              </div>
            ))}
          </div>
          {/* Breakevens + Greeks */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 px-2 py-1.5 rounded-lg bg-white/3 border border-white/6">
              <span className="text-[9px] text-white/55 uppercase tracking-wider">盈亏平衡</span>
              <span className="text-[11px] font-mono text-white/85">
                {result.beLower.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                {result.beUpper !== null && ` / ${result.beUpper.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 px-2 py-1.5 rounded-lg bg-white/3 border border-white/6">
              {[
                { label: 'Δ', val: result.netDelta.toFixed(3) },
                { label: 'Γ', val: result.netGamma.toFixed(5) },
                { label: 'ν/1%', val: `$${(result.netVega * S).toFixed(0)}` },
                { label: 'Θ/d', val: `$${(result.netTheta * S).toFixed(0)}` },
              ].map(g => (
                <div key={g.label} className="flex flex-col items-center">
                  <span className="text-[9px] text-white/55">{g.label}</span>
                  <span className="text-[10px] font-mono text-white/80">{g.val}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Leg detail */}
          <div className="flex gap-2">
            {[
              { label: buyLegLabel, strike: buyStrike!, price: result.buyPrice, color: 'var(--nexus-green)' },
              { label: sellLegLabel, strike: sellStrike!, price: result.sellPrice, color: 'var(--nexus-red)' },
            ].map(leg => (
              <div key={leg.label} className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/3 border border-white/6">
                <span className="text-[9px] font-bold" style={{ color: leg.color }}>{leg.label}</span>
                <span className="text-[10px] font-mono text-white/80">{leg.strike.toLocaleString()}</span>
                <span className="text-[10px] font-mono text-white/65">{fmtUSD(leg.price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
