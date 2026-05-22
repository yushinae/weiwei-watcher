import type { DeribitData, HistoryData, SkewSnap, DataSub, PollerEntry, VolConeSlice } from './types';
import { bsDelta } from '../lib/bs-math';
import { rollingRV, percentileAt } from '../lib/time-series';
import {
  BTC_POLY, ETH_POLY,
  FIXED_TENOR_VAR, VOL_CONE,
  VRP_HIST, IVR_HIST,
  VOL,
} from '../features/monitor/data/mock';

export const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseDeribitExpiry(s: string): Date | null {
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP[s.slice(2, 5)];
  const yr = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return new Date(Date.UTC(yr, mon, day, 8, 0, 0));
}

export function closestDeltaIV(opts: import('./types').ParsedOption[], targetAbsDelta: number): number {
  if (!opts.length) return 0;
  return opts.reduce((best, o) =>
    Math.abs(Math.abs(o.delta) - targetAbsDelta) < Math.abs(Math.abs(best.delta) - targetAbsDelta) ? o : best
  ).iv;
}

export function processDeribitResponse(results: any[]): DeribitData {
  const now = Date.now();
  const parsed: import('./types').ParsedOption[] = [];

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

  const groups = new Map<number, import('./types').ParsedOption[]>();
  for (const opt of parsed) {
    const key = Math.round(opt.daysToExp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }

  const expiries: import('./types').ExpiryGroup[] = [];
  for (const [days, opts] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (days < 2) continue;
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

  return { spot, dvol30, pcr, expiries, callVol24h, putVol24h, fetchedAt: now };
}

export const DERIBIT_CACHE = new Map<string, { data: DeribitData; ts: number }>();
export const CACHE_TTL = 60_000;

export const POLLERS = new Map<string, PollerEntry>();
let _isHidden = false;

async function _pollOnce(key: string): Promise<void> {
  if (_isHidden) return;
  const e = POLLERS.get(key);
  if (!e || e.subscribers.size === 0) return;
  try {
    const d = await e.fetcher();
    e.lastData = d;
    e.subscribers.forEach(fn => fn(d));
  } catch {}
}

function _resumeAll(): void {
  _isHidden = false;
  POLLERS.forEach((e, key) => {
    if (e.subscribers.size > 0 && e.timerId == null) {
      _pollOnce(key);
      e.timerId = setInterval(() => _pollOnce(key), e.intervalMs);
    }
  });
}

function _pauseAll(): void {
  _isHidden = true;
  POLLERS.forEach(e => {
    if (e.timerId != null) { clearInterval(e.timerId); e.timerId = null; }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () =>
    document.hidden ? _pauseAll() : _resumeAll()
  );
}

export function subscribeData<T>(
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

  if (entry.lastData !== undefined) subscriber(entry.lastData as T);

  if (entry.timerId == null && !_isHidden) {
    if (entry.lastData === undefined) _pollOnce(key);
    entry.timerId = setInterval(() => _pollOnce(key), intervalMs);
  }

  return () => {
    entry.subscribers.delete(subscriber as DataSub<unknown>);
    if (entry.subscribers.size === 0 && entry.timerId != null) {
      clearInterval(entry.timerId);
      entry.timerId = null;
    }
  };
}

export const SKEW_BUFFER = new Map<string, SkewSnap[]>();
export const SKEW_BUFFER_MAX = 480;

export async function fetchDeribitOptions(currency: 'BTC' | 'ETH'): Promise<DeribitData> {
  const cached = DERIBIT_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message ?? 'API error');
  const data = processDeribitResponse(json.result as any[]);
  DERIBIT_CACHE.set(currency, { data, ts: Date.now() });

  const snap: SkewSnap = {
    ts: Date.now(),
    tenors: data.expiries.slice(0, 5).map(e => ({ label: e.label, rr25: e.rr25, rr10: e.rr10, atm: e.atmIV })),
    pcr: data.pcr,
  };
  const skewBuf = SKEW_BUFFER.get(currency) ?? [];
  skewBuf.push(snap);
  if (skewBuf.length > SKEW_BUFFER_MAX) skewBuf.splice(0, skewBuf.length - SKEW_BUFFER_MAX);
  SKEW_BUFFER.set(currency, skewBuf);

  return data;
}

export const HIST_CACHE = new Map<string, { data: HistoryData; ts: number }>();
export const HIST_TTL = 900_000;

export async function fetchDeribitHistory(currency: 'BTC' | 'ETH'): Promise<HistoryData> {
  const cached = HIST_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < HIST_TTL) return cached.data;

  const now = Date.now();
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

  const data: HistoryData = { vrp, ivr, ivRankCurrent, dvolChange24h, volCone, rvByTenor, dvolSeries, rv30Series, fetchedAt: now };
  HIST_CACHE.set(currency, { data, ts: now });
  return data;
}
