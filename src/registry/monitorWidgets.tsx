import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import {
  BTC_POLY, ETH_POLY,
  FIXED_TENOR_VAR, VOL_CONE,
  VRP_HIST, IVR_HIST,
  VOL,
} from '../features/monitor/data/mock';

// ═══════════════════════════════════════════════════════════════════════════════
// Black-Scholes utilities
// ═══════════════════════════════════════════════════════════════════════════════

function normCDF(x: number): number {
  const a1 = 0.319381530, a2 = -0.356563782, a3 = 1.781477937,
        a4 = -1.821255978, a5 = 1.330274429;
  const L = Math.abs(x);
  const k = 1.0 / (1.0 + 0.2316419 * L);
  const w = 1.0 - (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * L * L) *
    k * (a1 + k * (a2 + k * (a3 + k * (a4 + k * a5))));
  return x >= 0 ? w : 1.0 - w;
}

function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsGamma(S: number, K: number, T: number, iv: number): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) return 0;
  const sigma = iv / 100;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return normPDF(d1) / (S * sigma * sqrtT);
}

function bsDelta(S: number, K: number, T: number, iv: number, type: 'C' | 'P'): number {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) return type === 'C' ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0);
  const sigma = iv / 100;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return type === 'C' ? normCDF(d1) : normCDF(d1) - 1;
}

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

  return { spot, dvol30, pcr, expiries, callVol24h, putVol24h, fetchedAt: now };
}

const DERIBIT_CACHE = new Map<string, { data: DeribitData; ts: number }>();
const CACHE_TTL = 30_000;

async function fetchDeribitOptions(currency: 'BTC' | 'ETH'): Promise<DeribitData> {
  const cached = DERIBIT_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message ?? 'API error');
  const data = processDeribitResponse(json.result as any[]);
  DERIBIT_CACHE.set(currency, { data, ts: Date.now() });
  return data;
}

function useDeribitOptions(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchDeribitOptions(coin)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });

    const timer = setInterval(() => {
      fetchDeribitOptions(coin)
        .then(d => { if (active) setData(d); })
        .catch(() => {});
    }, CACHE_TTL);

    return () => { active = false; clearInterval(timer); };
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
  fetchedAt: number;
}

const HIST_CACHE = new Map<string, { data: HistoryData; ts: number }>();
const HIST_TTL = 300_000; // 5 min – history moves slowly

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

  // ── Current rolling RV at [7,14,30,60,90,180,365] for FixedTenorWidget ────
  const RV_TENORS = [7, 14, 30, 60, 90, 180, 365] as const;
  const rvByTenor: number[] = RV_TENORS.map(t => {
    const s = rollingRV(logRets, t);
    return s[s.length - 1] ?? 0;
  });

  // ── Last 90D DVOL + aligned 30D-RV ──────────────────────────────────────────
  const SERIES_LEN = 90;
  const dvolSeries = dvolCloses.slice(-SERIES_LEN);
  const rv30Series = rv30All.slice(-SERIES_LEN);

  const data: HistoryData = { vrp, ivr, ivRankCurrent, dvolChange24h, volCone, rvByTenor, dvolSeries, rv30Series, fetchedAt: now };
  HIST_CACHE.set(currency, { data, ts: now });
  return data;
}

function useDeribitHistory(coin: Coin) {
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    let active = true;
    fetchDeribitHistory(coin)
      .then(d => { if (active) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [coin]);

  return { data };
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

const GRID   = 'rgba(255,255,255,0.05)';
const TXT    = 'rgba(255,255,255,0.3)';
const BRAND  = 'rgba(37,232,137,0.9)';
const YELLOW = '#F59E0B';
const BLUE   = '#4ea1ff';
const PURPLE = '#a78bfa';

function ivrColor(r: number) { return r <= 30 ? '#25a750' : r <= 70 ? '#F59E0B' : '#ca3f64'; }
function ivrLabel(r: number) { return r <= 20 ? '极低' : r <= 40 ? '偏低' : r <= 60 ? '中性' : r <= 80 ? '偏高' : '极高'; }
function pcrColor(p: number) { return p < 0.7 ? '#25a750' : p < 1.0 ? '#F59E0B' : '#ca3f64'; }
function pcrLabel(p: number) { return p < 0.7 ? '偏多' : p < 1.0 ? '中性' : '偏空'; }

// ── CoinTabs ──────────────────────────────────────────────────────────────────

const CoinTabs = ({ v, set }: { v: Coin; set: (c: Coin) => void }) => (
  <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
    {(['BTC', 'ETH'] as Coin[]).map(c => (
      <button key={c} onClick={() => set(c)}
        className={cn('text-[12px] font-bold px-2.5 py-0.5 rounded-[18px] transition-colors outline-none',
          v === c
            ? (c === 'BTC' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400')
            : 'text-slate-600 hover:text-slate-400'
        )}>
        {c}
      </button>
    ))}
  </div>
);

// ── Live badge ────────────────────────────────────────────────────────────────

const LiveBadge = () => (
  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
    实时
  </span>
);

// ── Loading skeleton ───────────────────────────────────────────────────────────

const Skeleton = () => (
  <div className="w-full h-full flex items-center justify-center">
    <span className="text-[11px] text-white/20 animate-pulse">正在加载实时数据…</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// SmileChart – real data version
// ═══════════════════════════════════════════════════════════════════════════════

// Delta "grid" for display: [10P, 25P, ATM, 25C, 10C] → target abs-deltas [.10, .25, .50, .25, .10]
// We plot call 25/10 and put 25/10 separately, ATM from calls
const SMILE_GRID = [0.10, 0.25, 0.50, 0.75, 0.90] as const;
const SMILE_LABELS_LIVE = ['10P', '25P', 'ATM', '25C', '10C'] as const;

interface SmileRow { label: string; values: number[] /* per expiry line */ }

function buildSmileRows(expiries: ExpiryGroup[]): { rows: SmileRow[]; lines: { label: string; color: string }[] } {
  // Map [10P, 25P, ATM, 25C, 10C] → IV for each expiry
  const lines: { label: string; color: string }[] = expiries.map((e, i) => ({
    label: e.label,
    color: [BRAND, YELLOW, BLUE][i] ?? TXT,
  }));
  const rows: SmileRow[] = SMILE_LABELS_LIVE.map((lbl, gi) => {
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

const SmileChartLive = ({
  expiries,
  onPick,
}: {
  expiries: ExpiryGroup[];
  onPick?: (p: { tenor: string; label: string; value: number }) => void;
}) => {
  if (!expiries.length) return <Skeleton />;
  const W = 320, H = 180, px = 28, py = 14;
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
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
};

// ═══════════════════════════════════════════════════════════════════════════════
// Historical charts – unchanged (use mock data)
// ═══════════════════════════════════════════════════════════════════════════════

const VRPChart = ({ data: d }: { data: { iv: number; rv: number }[] }) => {
  const W = 320, H = 140, px = 28, py = 12;
  const allV = d.flatMap(r => [r.iv, r.rv]);
  const lo = Math.floor(Math.min(...allV) / 5) * 5;
  const hi = Math.ceil(Math.max(...allV) / 5) * 5;
  const ivPts  = mapPts(d.map(r => r.iv), W, H, lo, hi, px, py);
  const rvPts  = mapPts(d.map(r => r.rv), W, H, lo, hi, px, py);
  const vrpPts = mapPts(d.map(r => r.iv - r.rv), W, H, 0, Math.ceil(Math.max(...d.map(r => r.iv - r.rv)) / 5) * 5, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[lo, lo + (hi - lo) / 2, hi].map(v => {
        const y = (H - py) - ((v - lo) / (hi - lo)) * (H - 2 * py);
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v.toFixed(0)}</text>
        </React.Fragment>;
      })}
      <path d={area(ivPts, H, py)} fill="rgba(37,232,137,0.07)" />
      <polyline points={poly(ivPts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={poly(rvPts)} fill="none" stroke={YELLOW} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,2" />
      <line x1={px + 2} y1={9} x2={px + 14} y2={9} stroke={BRAND} strokeWidth={1.5} />
      <text x={px + 17} y={12} fontSize={7} fill={TXT}>IV</text>
      <line x1={px + 35} y1={9} x2={px + 47} y2={9} stroke={YELLOW} strokeWidth={1.2} strokeDasharray="4,2" />
      <text x={px + 50} y={12} fontSize={7} fill={TXT}>RV</text>
    </svg>
  );
};

const IVRankChart = ({ data: d }: { data: number[] }) => {
  const W = 320, H = 120, px = 24, py = 10;
  const pts = mapPts(d, W, H, 0, 100, px, py);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0, 30, 70, 100].map(v => {
        const y = (H - py) - (v / 100) * (H - 2 * py);
        const col = v === 30 ? 'rgba(37,232,137,0.3)' : v === 70 ? 'rgba(202,63,100,0.3)' : GRID;
        return <React.Fragment key={v}>
          <line x1={px} y1={y} x2={W - px} y2={y} stroke={col} strokeWidth={v === 30 || v === 70 ? 0.8 : 0.5} strokeDasharray={v === 30 || v === 70 ? '3,2' : undefined} />
          <text x={px - 4} y={y + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>;
      })}
      <path d={area(pts, H, py)} fill="rgba(37,232,137,0.06)" />
      <polyline points={poly(pts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const VolConeChart = ({
  cone,
  currIVs,     // current ATM IV at each tenor (from options chain)
  tenorLabels, // e.g. ['7D','14D','30D','60D','90D','180D']
}: {
  cone: VolConeSlice;
  currIVs: number[];
  tenorLabels: string[];
}) => {
  const W = 320, H = 160, px = 28, py = 14;
  const allVals = [...cone.p90, ...currIVs].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;
  const hi = Math.ceil(Math.max(...allVals) / 10) * 10 + 5;
  function fy(v: number) { return (H - py) - (v / hi) * (H - 2 * py); }
  const n = cone.tenors.length;
  function fx(i: number) { return px + (i / (n - 1)) * (W - 2 * px); }
  const currPts = currIVs.map((v, i): [number, number] => [fx(i), fy(v)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
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
};

const FixedTenorChart = ({
  tenors,
  atmIVs,
  rvs,
}: {
  tenors: string[];
  atmIVs: number[];   // ATM IV at each tenor (from options chain)
  rvs: number[];      // rolling realized vol at same windows
}) => {
  const W = 320, H = 140, px = 28, py = 14;
  const allV = [...atmIVs, ...rvs].filter(v => v > 0);
  if (!allV.length) return <Skeleton />;
  const hi = Math.ceil(Math.max(...allV) / 10) * 10 + 5;
  function fy(v: number) { return (H - py) - (v / hi) * (H - 2 * py); }
  const n = tenors.length;
  const barW = (W - 2 * px) / n;
  const bw = barW * 0.3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {[0, 15, 30, 45, 60].filter(v => v <= hi).map(v => (
        <React.Fragment key={v}>
          <line x1={px} y1={fy(v)} x2={W - px} y2={fy(v)} stroke={GRID} strokeWidth={0.5} />
          <text x={px - 4} y={fy(v) + 3.5} textAnchor="end" fontSize={7} fill={TXT}>{v}</text>
        </React.Fragment>
      ))}
      {tenors.map((t, i) => {
        const cx = px + i * barW + barW / 2;
        const iv = atmIVs[i] ?? 0;
        const rv = rvs[i] ?? 0;
        return (
          <React.Fragment key={t}>
            <rect x={cx - bw - 1} y={fy(iv)} width={bw} height={Math.max(0, fy(0) - fy(iv))} rx={1.5} fill="rgba(37,232,137,0.55)" />
            <rect x={cx + 1}      y={fy(rv)} width={bw} height={Math.max(0, fy(0) - fy(rv))} rx={1.5} fill="rgba(37,167,80,0.42)" />
            <text x={cx} y={H - 3} textAnchor="middle" fontSize={7} fill={TXT}>{t}</text>
          </React.Fragment>
        );
      })}
      <rect x={px} y={5} width={8} height={6} rx={1} fill="rgba(37,232,137,0.55)" />
      <text x={px + 11} y={10} fontSize={7} fill={TXT}>ATM IV</text>
      <rect x={px + 50} y={5} width={8} height={6} rx={1} fill="rgba(37,167,80,0.42)" />
      <text x={px + 61} y={10} fontSize={7} fill={TXT}>已实现 RV</text>
    </svg>
  );
};

// Dynamic implied distribution – recomputes when spot/iv change
function lnDistPts(S: number, iv: number, T: number, pts = 80) {
  const sigma = (iv / 100) * Math.sqrt(T / 365);
  const mu = Math.log(S) - 0.5 * sigma * sigma;
  return Array.from({ length: pts }, (_, i) => {
    const x = S * (0.55 + (i * 0.9) / (pts - 1));
    const z = (Math.log(x) - mu) / sigma;
    return { x, y: Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI)) };
  });
}

const ImpliedDistChart = ({ spot, iv30 }: { spot: number; iv30: number }) => {
  const data = lnDistPts(spot, iv30, 30);
  const W = 320, H = 140, px = 8, py = 12;
  const xs = data.map(d => d.x); const ys = data.map(d => d.y);
  const lo = Math.min(...xs); const hi = Math.max(...xs);
  const yHi = Math.max(...ys) * 1.1;
  function fx(x: number) { return px + ((x - lo) / (hi - lo)) * (W - 2 * px); }
  function fy(y: number) { return (H - py) - (y / yHi) * (H - 2 * py); }
  const curvePts: [number, number][] = data.map(d => [fx(d.x), fy(d.y)]);
  const aFill = `${smooth(curvePts)} L ${curvePts[curvePts.length - 1][0].toFixed(1)} ${fy(0)} L ${curvePts[0][0].toFixed(1)} ${fy(0)} Z`;
  const sigma = (iv30 / 100) * Math.sqrt(30 / 365) * spot;
  const xS = fx(spot);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <path d={`M ${fx(spot - sigma)} ${py} L ${fx(spot - sigma)} ${H - py} L ${fx(spot + sigma)} ${H - py} L ${fx(spot + sigma)} ${py} Z`} fill="rgba(37,232,137,0.06)" />
      <line x1={px} y1={H - py} x2={W - px} y2={H - py} stroke={GRID} strokeWidth={0.5} />
      <path d={aFill} fill="rgba(37,232,137,0.10)" />
      <path d={smooth(curvePts)} fill="none" stroke={BRAND} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={fx(spot - sigma)} y1={py} x2={fx(spot - sigma)} y2={H - py} stroke="rgba(37,232,137,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={fx(spot + sigma)} y1={py} x2={fx(spot + sigma)} y2={H - py} stroke="rgba(37,232,137,0.3)" strokeWidth={0.8} strokeDasharray="3,2" />
      <line x1={xS} y1={py} x2={xS} y2={H - py} stroke={YELLOW} strokeWidth={1} strokeDasharray="2,2" />
      {[-2, -1, 0, 1, 2].map(k => {
        const x = fx(spot + k * sigma);
        const lbl = k === 0 ? 'S' : `${k > 0 ? '+' : ''}${k}σ`;
        return <text key={k} x={x} y={H - 3} textAnchor="middle" fontSize={7} fill={k === 0 ? YELLOW : TXT}>{lbl}</text>;
      })}
    </svg>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// useCoinControl + WidgetShell
// ═══════════════════════════════════════════════════════════════════════════════

type CoinControlProps = { coin?: Coin; onCoinChange?: (c: Coin) => void };

function useCoinControl({ coin: coinProp, onCoinChange }: CoinControlProps) {
  const [localCoin, setLocalCoin] = useState<Coin>(coinProp ?? 'BTC');
  useEffect(() => { if (coinProp !== undefined) setLocalCoin(coinProp); }, [coinProp]);
  const coin = localCoin;
  const setCoin = (c: Coin) => { setLocalCoin(c); onCoinChange?.(c); };
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
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
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
          <span className="text-[11px] text-white/20 animate-pulse">正在加载实时数据…</span>
        </div>
      )}
      <div className="flex items-center px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">波动率概览</span>
      </div>
      <div className="mx-2 mb-2 rounded-[8px] bg-surface-1/40 border border-surface-4/50 overflow-hidden shrink-0">
        {/* DVOL row */}
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-surface-2/80">
          <span className="text-[13px] font-bold text-slate-100">{coin} {data ? 'ATM 30D' : 'DVOL'}</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-mono font-bold tnum text-slate-100 leading-none">{dvol.toFixed(1)}</span>
            <span className="text-[11px] text-slate-600">%</span>
            {histData && (
              <span className={cn('text-[11px] font-mono tnum font-bold', dvolChg < 0 ? 'text-rose-400' : 'text-emerald-400')}>
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
              <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">IV Rank</div>
              {histData ? <LiveBadge /> : <span className="text-[8px] text-slate-700">估</span>}
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
              <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">VRP</div>
              {histData ? <LiveBadge /> : <span className="text-[8px] text-slate-700">估</span>}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none text-amber-400 mb-0.5">
              {vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}<span className="text-[10px] text-slate-600 font-normal ml-0.5">pp</span>
            </div>
            <div className="text-[9px] font-mono text-slate-600">IV {iv30.toFixed(1)} − RV {rv30.toFixed(1)}</div>
          </div>
          {/* PCR */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-1 mb-1">
              <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">PCR</div>
              {data && <LiveBadge />}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-0.5" style={{ color: pcrc }}>{pcr.toFixed(2)}</div>
            <div className="text-[9px] font-mono" style={{ color: pcrc }}>{pcrLabel(pcr)}</div>
          </div>
        </div>
        {/* Term structure */}
        <div className="border-t border-surface-2/80 px-3 pt-2 pb-2.5">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">期限结构 ATM IV</div>
            {data && <LiveBadge />}
          </div>
          <div className="flex gap-0.5 items-end h-[40px]">
            {termItems.map((t, i) => {
              const barH = Math.round(8 + ((t.iv - termMin) / termRange) * 26);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <span className="text-[8px] font-mono tnum text-slate-600 leading-none">{t.iv.toFixed(0)}</span>
                  <div className="w-full rounded-t-[2px]" style={{ height: barH, background: 'linear-gradient(to top,rgba(37,232,137,.55),rgba(37,232,137,.2))' }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-0.5 mt-0.5">
            {termItems.map((t, i) => (
              <div key={i} className="flex-1 flex justify-center">
                <span className="text-[8px] text-slate-700">{t.t}</span>
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
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
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
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
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
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
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

const FIXED_TENORS_DAYS = [7, 14, 30, 60, 90, 180, 365] as const;
const FIXED_TENOR_LABELS = FIXED_TENORS_DAYS.map(d => `${d}D`);

export const FixedTenorWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { data: optData } = useDeribitOptions(coin);
  const mock = FIXED_TENOR_VAR[coin];
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {(histData && optData) && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData, optData]);

  const hasReal = !!(histData && optData);

  // ATM IVs: pick options chain closest to each tenor
  const atmIVs: number[] = FIXED_TENORS_DAYS.map((days, i) => {
    if (optData?.expiries.length) {
      const e = optData.expiries.reduce((best, ex) =>
        Math.abs(ex.daysToExp - days) < Math.abs(best.daysToExp - days) ? ex : best
      );
      return e.atmIV;
    }
    return mock.varSwap[i] ?? 0;
  });

  // Rolling RV: from history rvByTenor (indexed same as FIXED_TENORS_DAYS)
  const rvs: number[] = FIXED_TENORS_DAYS.map((_, i) =>
    histData?.rvByTenor[i] ?? mock.rv[i] ?? 0
  );

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <FixedTenorChart
          tenors={hasReal ? FIXED_TENOR_LABELS : mock.tenors as string[]}
          atmIVs={hasReal ? atmIVs : mock.varSwap as number[]}
          rvs={hasReal ? rvs : mock.rv as number[]}
        />
      </div>
    </div>
  );
};

// ImpliedDist uses real spot + 30D IV when available
export const ImpliedDistWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const mock = VOL[coin];
  const spot = data?.spot ?? (coin === 'BTC' ? 95000 : 3200);
  const iv30 = data?.dvol30 ?? mock.iv30;
  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      <ImpliedDistChart spot={spot} iv30={iv30} />
    </WidgetShell>
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
              <th className="text-left px-2 py-1.5 text-slate-600 font-bold">Δ / Exp</th>
              {cols.map(e => (
                <th key={e.label} className="px-2 py-1.5 text-slate-600 font-bold text-right">{e.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SURFACE_ROWS.map((row, ri) => (
              <tr key={row.label} className={ri === 2 ? 'border-t border-b border-border-subtle' : ''}>
                <td className={cn('px-2 py-1.5 font-mono font-bold', ri === 2 ? 'text-slate-300' : 'text-slate-500')}>
                  {row.label}
                </td>
                {tableData[ri].map((v, ci) => (
                  <td
                    key={ci}
                    role={onPickCell ? 'button' : undefined}
                    tabIndex={onPickCell ? 0 : undefined}
                    className={cn(
                      'px-2 py-1.5 text-right font-mono tnum text-slate-200 font-bold',
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
                    <th key={h} className="px-2 py-1.5 text-slate-600 font-bold text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-2 transition-colors">
                    <td className="px-2 py-1.5 font-mono font-bold text-slate-400">{r.exp}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-slate-200 font-bold">{r.atm.toFixed(1)}</td>
                    <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr25 < 0 ? 'text-rose-400' : 'text-emerald-400')}>{r.rr25.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-amber-400 font-bold">{r.bf25.toFixed(1)}</td>
                    <td className={cn('px-2 py-1.5 text-right font-mono tnum font-bold', r.rr10 < 0 ? 'text-rose-400/70' : 'text-emerald-400/70')}>{r.rr10.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-amber-400/70 font-bold">{r.bf10.toFixed(1)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-600 text-[11px]">暂无数据</td>
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
// PolymarketWidget – mock
// ═══════════════════════════════════════════════════════════════════════════════

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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setSelectedExp(0); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!exp) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

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
                : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]',
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
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">IV%</th>
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">Δ</th>
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">OI</th>
              <th className="text-center px-3 py-1.5 text-[9px] uppercase tracking-wider text-white/40 font-semibold bg-white/[0.03]">行权价</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">OI</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">Δ</th>
              <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-wider text-white/25 font-normal">IV%</th>
            </tr>
            <tr className="border-b border-white/[0.03]">
              <th colSpan={3} className="text-center py-0.5 text-[8px] text-emerald-400/40 font-normal">CALL</th>
              <th className="bg-white/[0.03]" />
              <th colSpan={3} className="text-center py-0.5 text-[8px] text-rose-400/40 font-normal">PUT</th>
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
                  <td className={cn('text-right px-2 py-1.5 font-mono tnum', aboveSpot ? 'text-white/30' : 'text-emerald-400/80')}>
                    {call ? fmt(call.iv) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/40">
                    {call ? call.delta.toFixed(2) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/35">
                    {call ? fmtOI(call.oi) : '—'}
                  </td>
                  {/* Strike */}
                  <td className={cn(
                    'text-center px-3 py-1.5 font-mono font-bold bg-white/[0.03]',
                    isAtm ? 'text-[var(--nexus-accent)]' : 'text-white/70',
                  )}>
                    {strike.toLocaleString()}
                    {isAtm && <span className="ml-1 text-[8px] text-[var(--nexus-accent)]/60">ATM</span>}
                  </td>
                  {/* Put side */}
                  <td className="text-left px-2 py-1.5 font-mono tnum text-white/35">
                    {put ? fmtOI(put.oi) : '—'}
                  </td>
                  <td className="text-left px-2 py-1.5 font-mono tnum text-white/40">
                    {put ? put.delta.toFixed(2) : '—'}
                  </td>
                  <td className={cn('text-left px-2 py-1.5 font-mono tnum', aboveSpot ? 'text-rose-400/80' : 'text-white/30')}>
                    {put ? fmt(put.iv) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

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
              : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]',
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
                : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 px-3 pb-2 text-[10px] shrink-0">
        <span className="text-white/30">Call OI <span className="font-mono text-emerald-400/80">{fmtOI(totalCallOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">Put OI <span className="font-mono text-rose-400/80">{fmtOI(totalPutOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">PCR <span className="font-mono text-amber-400/80">{pcr.toFixed(2)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/30">最大痛点 <span className="font-mono text-[var(--nexus-accent)]/80">{maxPain.toLocaleString()}</span></span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/20">暂无持仓数据</div>
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
                const isAtm     = isSpot || Math.abs(strike - spot) === Math.min(...strikes.map(k => Math.abs(k - spot)));
                const labelColor = isSpot ? '#F59E0B' : isMaxPain ? 'rgba(37,232,137,0.9)' : 'rgba(255,255,255,0.45)';

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

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        ◆ 现货价  ★ 最大痛点  数据来源：Deribit · {expFilter === 'all' ? '全部到期日' : expFilter}
      </div>
    </div>
  );
};

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
const FLOW_TTL = 60_000; // 1 min

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
    const raw: Array<{ timestamp: number; interest: number }> = json?.result ?? [];
    fundingHistory = raw.map(r => ({ ts: r.timestamp, rate: r.interest * 100 }));
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
    fetchFlowData(currency)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    const timer = setInterval(() => {
      fetchFlowData(currency).then(d => { if (active) setData(d); }).catch(() => {});
    }, FLOW_TTL);
    return () => { active = false; clearInterval(timer); };
  }, [currency]);

  return { data, loading };
}

// ── Fear & Greed standalone hook (no coin dependency) ─────────────────────────
// Reuses FLOW_CACHE via BTC key since F&G is coin-agnostic
function useFearGreed() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchFlowData('BTC')
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

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
              expFilter === f ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
            )}>
            {f === 'all' ? '全部' : f}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex gap-2 px-3 py-2 shrink-0">
        {[
          { label: '净 GEX', val: fmtGex(totalNet), color: totalNet >= 0 ? '#25e889' : '#f87171' },
          { label: '零 Gamma', val: zeroGamma ? fmtPx(zeroGamma) : '—', color: '#F59E0B' },
          { label: '现货', val: fmtPx(spot), color: 'rgba(255,255,255,0.6)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
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
                  fill={isSpot ? '#F59E0B' : isZero ? '#a78bfa' : 'rgba(255,255,255,0.35)'}
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

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
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
  const { data: histData } = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  if (!histData) return <Skeleton />;

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
          { label: 'VRP', val: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}%`, color: vrp >= 0 ? '#25e889' : '#f87171' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
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
          <path d={area(rvPts, H, PY)} fill="rgba(78,161,255,0.07)" />
          <polyline points={poly(rvPts)} fill="none" stroke={BLUE} strokeWidth={1.2} strokeDasharray="3,2" opacity={0.7} />
          {/* DVOL area */}
          <path d={area(dvolPts, H, PY)} fill="rgba(37,232,137,0.06)" />
          <polyline points={poly(dvolPts)} fill="none" stroke={BRAND} strokeWidth={1.5} opacity={0.9} />
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 pb-2 shrink-0">
        {[{ c: BRAND, l: 'DVOL (Deribit)' }, { c: BLUE, l: 'RV 30D', dash: true }].map(({ c, l, dash }) => (
          <div key={l} className="flex items-center gap-1.5">
            <svg width={16} height={4}><line x1={0} y1={2} x2={16} y2={2} stroke={c} strokeWidth={1.5} strokeDasharray={dash ? '3,2' : undefined} /></svg>
            <span className="text-[9px] text-white/30">{l}</span>
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fundingHistory.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无资金费率数据</div>
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
  const fundColor = data.currentFunding8h >= 0 ? '#25e889' : '#f87171';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 8H 费率', val: fmtRate(data.currentFunding8h), color: fundColor },
          { label: '年化费率', val: `${data.annFunding >= 0 ? '+' : ''}${data.annFunding.toFixed(1)}%`, color: fundColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
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

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.basis.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无期货数据</div>
  );

  const { basis } = data;
  const maxBasis = Math.max(...basis.map(b => Math.abs(b.annBasis)), 1);
  const BAR_MAX = 180, ROW_H = 36, PAD_X = 12;

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <span className="text-[10px] font-bold text-white/25 uppercase tracking-wider">年化基差（期货 vs 现货）</span>
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
                <div className="text-[9px] text-white/25">{b.daysToExp}天 · ${px(b.futurePx)}</div>
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
      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span>}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const callVol = data.callVol24h;
  const putVol  = data.putVol24h;
  const total   = callVol + putVol;
  const callPct = total > 0 ? (callVol / total) * 100 : 50;
  const putPct  = 100 - callPct;
  const volRatio = callVol > 0 ? putVol / callVol : 1;

  const fmtVol = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const sentiment = callPct > 55 ? { label: '看涨偏向', color: '#25e889' }
                  : callPct < 45 ? { label: '看跌偏向', color: '#f87171' }
                  : { label: '中性', color: '#F59E0B' };

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
          { label: 'Put 成交量', val: fmtVol(putVol), color: '#f87171' },
          { label: 'P/C 比', val: volRatio.toFixed(2), color: '#F59E0B' },
          { label: '方向', val: sentiment.label, color: sentiment.color },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Call/Put ratio bar */}
      <div className="px-3 pb-2 shrink-0">
        <div className="flex items-center justify-between text-[9px] text-white/30 mb-1">
          <span>Call {callPct.toFixed(0)}%</span>
          <span>Put {putPct.toFixed(0)}%</span>
        </div>
        <div className="flex h-[6px] rounded-full overflow-hidden bg-white/[0.05]">
          <div className="h-full bg-[#25e889]/70 transition-all" style={{ width: `${callPct}%` }} />
          <div className="h-full bg-[#f87171]/70 flex-1" />
        </div>
      </div>

      {/* Per-expiry flow */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">按到期日拆分</div>
        {expVol.map((e, i) => {
          const total = e.callV + e.putV;
          const cPct = total > 0 ? (e.callV / total) * 100 : 50;
          const barTotal = (total / maxExpVol) * 100;
          return (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <div className="w-[32px] text-[10px] font-mono text-white/40 shrink-0">{e.label}</div>
              <div className="flex-1 flex h-[12px] rounded-[3px] overflow-hidden bg-white/[0.04]" style={{ maxWidth: `${barTotal}%` }}>
                <div className="h-full bg-[#25e889]/60" style={{ width: `${cPct}%` }} />
                <div className="h-full bg-[#f87171]/60 flex-1" />
              </div>
              <div className="text-[9px] text-white/25 font-mono shrink-0 w-[28px] text-right">{fmtVol(total)}</div>
            </div>
          );
        })}
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        24H 期权成交量（合约数）· Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// FearGreedWidget — 恐慌贪婪指数
// ═══════════════════════════════════════════════════════════════════════════════

const FG_ZONES = [
  { min: 0,  max: 25,  label: '极度恐慌', color: '#ef4444' },
  { min: 25, max: 45,  label: '恐慌',     color: '#f97316' },
  { min: 45, max: 55,  label: '中性',     color: '#F59E0B' },
  { min: 55, max: 75,  label: '贪婪',     color: '#84cc16' },
  { min: 75, max: 100, label: '极度贪婪', color: '#22c55e' },
];
function fgColor(v: number) {
  return FG_ZONES.find(z => v >= z.min && v <= z.max)?.color ?? '#F59E0B';
}

export const FearGreedWidget = () => {
  const { data, loading } = useFearGreed();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(data ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />实时</span> : null);
    return () => setHeaderRight(null);
  }, [setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fearGreed.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无数据</div>
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
              <span className="text-[9px] text-white/30">{z.label}</span>
              <span className="text-[9px] text-white/15 ml-auto">{z.min}–{z.max}</span>
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

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        数据来源：alternative.me · 30天历史
      </div>
    </div>
  );
};

export const PolymarketWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  const markets = coin === 'BTC' ? BTC_POLY : ETH_POLY;
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="flex items-center px-3 pt-2 pb-1.5 shrink-0">
        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Polymarket</span>
      </div>
      {markets.map((m, i) => {
        const yc = m.yes >= 50 ? '#25a750' : '#F59E0B';
        return (
          <div key={i} className="px-3 py-2.5 border-t border-surface-4 hover:bg-surface-2 transition-colors cursor-pointer">
            <p className="text-[11px] text-slate-300 leading-snug mb-2">{m.q}</p>
            <div className="flex h-1 rounded-full overflow-hidden bg-surface-4 mb-1.5">
              <div className="h-full" style={{ width: `${m.yes}%`, backgroundColor: yc }} />
              <div className="h-full flex-1 bg-rose-500/20" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <span className="text-[10px] font-mono font-bold tnum" style={{ color: yc }}>YES {m.yes}%</span>
                <span className="text-[10px] font-mono font-bold tnum text-rose-400/60">NO {100 - m.yes}%</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[9px] text-slate-700">{m.vol}</span>
                <span className="text-[9px] font-mono text-slate-700">{m.end}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
