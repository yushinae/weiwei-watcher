// ═══════════════════════════════════════════════════════════════════════════════
// Position analytics — expiry payoff diagram + Bybit-native Greek breakdown.
//
// No option-pricing model: everything is built straight from Bybit's data.
//   • Expiry P&L curve  = Σ sign·qty·(intrinsic(S) − entryPremium)   ← strike / side
//                         / qty / avgPrice only, deterministic, no IV
//   • Greeks            = Bybit's reported per-position Δ/Γ/ν/Θ, summed and
//                         broken down per leg (no BS recompute, no curve extrapolation)
//
// Spot grids are per-coin (different price scales) so each coin gets its own card.
// Live index spot (DERIBIT_WS) only positions the "现价" marker on the payoff axis.
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import EChart from '../../components/echart/EChart';
import { DERIBIT_WS } from '../../registry/data/ws';
import { cn } from '../../lib/utils';
import { BLUE, BRAND, RED, YELLOW } from '../../registry/lib/widget-colors';
import type { BybitOptionPosition } from './rest';

type Coin = 'BTC' | 'ETH' | 'SOL';

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};
const INDEX_NAME: Record<Coin, string> = { BTC: 'btc_usd', ETH: 'eth_usd', SOL: 'sol_usd' };
const N_POINTS = 121;
const UP = '#28C840', DOWN = '#FF5F57';

interface ParsedSymbol { coin: Coin; expiryTs: number; strike: number; type: 'C' | 'P' }

function parseSymbol(symbol: string): ParsedSymbol | null {
  const parts = symbol.split('-');
  if (parts.length !== 4) return null;
  const coin = parts[0];
  if (coin !== 'BTC' && coin !== 'ETH' && coin !== 'SOL') return null;
  const day = parseInt(parts[1].slice(0, 2));
  const mon = MONTH_MAP[parts[1].slice(2, 5)];
  const yr  = 2000 + parseInt(parts[1].slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const strike = parseInt(parts[2]);
  if (isNaN(strike)) return null;
  const type = parts[3] === 'C' ? 'C' : parts[3] === 'P' ? 'P' : null;
  if (!type) return null;
  return { coin, expiryTs: Date.UTC(yr, mon, day, 8, 0, 0), strike, type };
}

const num = (v: string | number | undefined) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return isNaN(n) ? 0 : n;
};

interface LegRow {
  label: string;        // "66000P"
  K: number;
  type: 'C' | 'P';
  sign: 1 | -1;
  qty: number;
  entry: number;
  // Bybit-reported greek contributions (signed, scaled by qty)
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

interface CoinModel {
  id: string;
  coin: Coin;
  expiryLabel?: string;   // set in "by expiry" mode
  dte?: number;           // days to expiry (by expiry mode)
  center: number;
  xs: number[];
  expiryPL: number[];
  breakevens: number[];
  maxProfit: number;
  maxLoss: number;
  netPremium: number;   // +paid (debit) / −received (credit)
  unrealised: number;
  legs: LegRow[];
  net: { delta: number; gamma: number; vega: number; theta: number };
}

function buildModel(
  coin: Coin,
  rows: BybitOptionPosition[],
  liveSpot: number | undefined,
  expiry?: { ts: number; label: string },
): CoinModel | null {
  const now = Date.now();
  const legs: LegRow[] = [];
  const strikes: number[] = [];
  let unrealised = 0;

  for (const p of rows) {
    const parsed = parseSymbol(p.symbol);
    if (!parsed || parsed.expiryTs <= now) continue;
    const qty = Math.abs(num(p.size));
    if (qty === 0) continue;
    const sign: 1 | -1 = p.side === 'Sell' ? -1 : 1;
    unrealised += num(p.unrealisedPnl);
    strikes.push(parsed.strike);
    legs.push({
      label: `${parsed.strike}${parsed.type}`,
      K: parsed.strike,
      type: parsed.type,
      sign,
      qty,
      entry: num(p.avgPrice),
      delta: num(p.delta) * sign * qty,
      gamma: num(p.gamma) * sign * qty,
      vega:  num(p.vega)  * sign * qty,
      theta: num(p.theta) * sign * qty,
    });
  }
  if (legs.length === 0) return null;

  const center = liveSpot && liveSpot > 0
    ? liveSpot
    : strikes.reduce((a, b) => a + b, 0) / strikes.length;

  const lo = Math.min(center * 0.6, Math.min(...strikes) * 0.8);
  const hi = Math.max(center * 1.4, Math.max(...strikes) * 1.2);
  const xs = Array.from({ length: N_POINTS }, (_, i) => lo + (hi - lo) * i / (N_POINTS - 1));

  const intrinsic = (l: LegRow, S: number) =>
    l.type === 'C' ? Math.max(0, S - l.K) : Math.max(0, l.K - S);
  const expiryPL = xs.map(S => legs.reduce((sum, l) => sum + l.sign * l.qty * (intrinsic(l, S) - l.entry), 0));

  const breakevens: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    if (expiryPL[i - 1] * expiryPL[i] < 0) {
      const t = -expiryPL[i - 1] / (expiryPL[i] - expiryPL[i - 1]);
      breakevens.push(xs[i - 1] + t * (xs[i] - xs[i - 1]));
    }
  }

  return {
    id: expiry ? `${coin}-${expiry.ts}` : coin,
    coin,
    expiryLabel: expiry?.label,
    dte: expiry ? Math.max(0, (expiry.ts - now) / 86_400_000) : undefined,
    center, xs, expiryPL, breakevens,
    maxProfit: Math.max(...expiryPL),
    maxLoss: Math.min(...expiryPL),
    netPremium: legs.reduce((s, l) => s + l.sign * l.qty * l.entry, 0),
    unrealised,
    legs,
    net: {
      delta: legs.reduce((s, l) => s + l.delta, 0),
      gamma: legs.reduce((s, l) => s + l.gamma, 0),
      vega:  legs.reduce((s, l) => s + l.vega, 0),
      theta: legs.reduce((s, l) => s + l.theta, 0),
    },
  };
}

// ── Live index spot per coin (throttled to 1s) ──────────────────────────────
function useIndexSpots(coins: Coin[]): Partial<Record<Coin, number>> {
  const key = coins.slice().sort().join(',');
  const [spots, setSpots] = useState<Partial<Record<Coin, number>>>({});
  useEffect(() => {
    if (coins.length === 0) return;
    const latest: Partial<Record<Coin, number>> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { timer = null; setSpots(s => ({ ...s, ...latest })); };
    const unsubs = coins.map(c =>
      DERIBIT_WS.subscribe<{ price: number }>(`deribit_price_index.${INDEX_NAME[c]}`, ({ price }) => {
        latest[c] = price;
        if (timer === null) timer = setTimeout(flush, 1000);
      }),
    );
    return () => { unsubs.forEach(u => u()); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return spots;
}

function expiryLabelFromTs(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ── Formatting ──────────────────────────────────────────────────────────────
const fmtUsd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const fmtSigned = (v: number) =>
  `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const upDown = (v: number) => (v > 0 ? 'text-trade-up' : v < 0 ? 'text-trade-down' : 'text-white/55');

// ─────────────────────────────────────────────────────────────────────────────

export default function PositionAnalytics({ positions }: { positions: BybitOptionPosition[] }) {
  const [byExpiry, setByExpiry] = useState(false);

  const coins = useMemo(() => {
    const set = new Set<Coin>();
    for (const p of positions) { const c = parseSymbol(p.symbol)?.coin; if (c) set.add(c); }
    return [...set];
  }, [positions]);

  const spots = useIndexSpots(coins);

  // Greeks come straight from Bybit, so curves don't depend on live spot — only
  // the payoff x-range / marker does. Bucket the spot so a sub-dollar tick
  // doesn't rebuild the charts every second.
  const spotKey = coins.map(c => `${c}:${Math.round((spots[c] ?? 0) / 25)}`).join('|');
  const models = useMemo(() => {
    const out: CoinModel[] = [];
    for (const c of coins) {
      const coinRows = positions.filter(p => parseSymbol(p.symbol)?.coin === c);
      if (byExpiry) {
        const byTs = new Map<number, BybitOptionPosition[]>();
        for (const p of coinRows) {
          const ts = parseSymbol(p.symbol)?.expiryTs;
          if (ts === undefined) continue;
          (byTs.get(ts) ?? byTs.set(ts, []).get(ts)!).push(p);
        }
        for (const [ts, rows] of [...byTs.entries()].sort((a, b) => a[0] - b[0])) {
          const m = buildModel(c, rows, spots[c], { ts, label: expiryLabelFromTs(ts) });
          if (m) out.push(m);
        }
      } else {
        const m = buildModel(c, coinRows, spots[c]);
        if (m) out.push(m);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, spotKey, byExpiry]);

  if (models.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/50">视图</span>
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#111111]">
          {([['combined', '合并'], ['expiry', '按到期']] as const).map(([key, label]) => {
            const active = (key === 'expiry') === byExpiry;
            return (
              <button
                key={key}
                onClick={() => setByExpiry(key === 'expiry')}
                className={cn(
                  'h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors duration-[120ms]',
                  active ? 'bg-[#242424] text-white/90' : 'text-white/55 hover:text-white/80',
                )}
              >{label}</button>
            );
          })}
        </div>
      </div>
      {models.map(m => <CoinCard key={m.id} m={m} liveSpot={spots[m.coin]} />)}
    </div>
  );
}

function CoinCard({ m, liveSpot }: { m: CoinModel; liveSpot: number | undefined; key?: string }) {
  const spot = liveSpot && liveSpot > 0 ? liveSpot : m.center;

  return (
    <div className="widget-card p-0 overflow-hidden">
      {/* Stats header */}
      <div className="flex items-center flex-wrap gap-x-7 gap-y-3 px-[18px] pt-[14px] pb-[12px]">
        <div className="flex items-center gap-2.5 mr-1">
          <span className="h-7 inline-flex items-center px-2 rounded-md bg-white/[0.06] text-[12px] font-bold text-white/80 gap-1.5">
            {m.coin}
            {m.expiryLabel && (
              <span className="text-[11px] font-semibold text-brand/90">{m.expiryLabel}</span>
            )}
          </span>
          {m.dte !== undefined && (
            <Stat label="剩余" value={`${m.dte.toFixed(1)} 天`} className="text-white/70" />
          )}
          <Stat label="现价" value={fmtUsd(spot)} className="text-white/85" />
        </div>
        <Stat label="未实现盈亏" value={fmtSigned(m.unrealised)} className={upDown(m.unrealised)} />
        <Stat label={m.netPremium >= 0 ? '净支出权利金' : '净收取权利金'}
              value={fmtUsd(Math.abs(m.netPremium))} className={m.netPremium >= 0 ? 'text-trade-down' : 'text-trade-up'} />
        <div className="h-7 w-px bg-white/8" />
        <Stat label="范围内最大盈利" value={fmtSigned(m.maxProfit)} className="text-trade-up" />
        <Stat label="范围内最大亏损" value={fmtSigned(m.maxLoss)} className="text-trade-down" />
        <Stat label="盈亏平衡"
              value={m.breakevens.length ? m.breakevens.map(b => fmtUsd(b).replace('$', '')).join(' / ') : '—'}
              className="text-white/75" />
      </div>

      {/* Expiry payoff diagram */}
      <div className="px-3 pb-1">
        <div className="text-[11px] text-white/50 px-[6px] pb-1">到期损益图</div>
        <div className="h-[300px]">
          <EChart option={payoffOption(m, spot)} />
        </div>
      </div>

      {/* Bybit Greek breakdown (per leg) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-3 pb-3 pt-1">
        <GreekBars title="Delta" sub="方向敞口" legs={m.legs} pick={l => l.delta} net={m.net.delta} digits={3} accent={BLUE} />
        <GreekBars title="Gamma" sub="Δ 变化率" legs={m.legs} pick={l => l.gamma} net={m.net.gamma} digits={4} accent={BRAND} />
        <GreekBars title="Vega"  sub="每 1% IV" legs={m.legs} pick={l => l.vega}  net={m.net.vega}  digits={1} accent={YELLOW} />
        <GreekBars title="Theta" sub="每日衰减" legs={m.legs} pick={l => l.theta} net={m.net.theta} digits={1} accent={RED} />
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-white/50 font-medium tracking-wide whitespace-nowrap">{label}</span>
      <span className={cn('text-[14px] font-bold font-mono tnum', className ?? 'text-white/80')}>{value}</span>
    </div>
  );
}

// ── ECharts: expiry payoff ───────────────────────────────────────────────────

function payoffOption(m: CoinModel, spot: number): EChartsOption {
  // Split the curve at its zero-crossings into profit (green) / loss (red)
  // segments. ECharts 6 ignores visualMap colouring on this line, so we colour
  // explicitly — null gaps break each line where the other sign takes over.
  const pos: (number | null)[][] = [];
  const neg: (number | null)[][] = [];
  for (let i = 0; i < m.xs.length; i++) {
    const x = m.xs[i], y = m.expiryPL[i];
    if (i > 0) {
      const yp = m.expiryPL[i - 1];
      if (yp * y < 0) {
        const xc = m.xs[i - 1] + (-yp / (y - yp)) * (x - m.xs[i - 1]);
        pos.push([xc, 0]); neg.push([xc, 0]);
      }
    }
    if (y >= 0) { pos.push([x, y]); neg.push([x, null]); }
    else { pos.push([x, null]); neg.push([x, y]); }
  }

  const beMarks = m.breakevens.map(b => ({
    xAxis: b,
    lineStyle: { color: YELLOW, width: 1, type: 'dotted' as const, opacity: 0.65 },
    label: { show: true, formatter: fmtUsd(b).replace('$', ''), color: YELLOW, fontSize: 9, position: 'insideEndBottom' as const },
  }));

  const lineSeg = (name: string, data: (number | null)[][], color: string, withMarks: boolean) => ({
    name, type: 'line' as const, data,
    showSymbol: false, connectNulls: false,
    lineStyle: { width: 2, color },
    areaStyle: { color, opacity: 0.1, origin: 0 as const },
    z: 3,
    ...(withMarks ? {
      markLine: {
        symbol: 'none' as const, silent: true,
        lineStyle: { color: 'rgba(255,255,255,0.22)', width: 1 },
        label: { show: false },
        data: [
          { yAxis: 0 },
          ...beMarks,
          {
            xAxis: spot,
            lineStyle: { color: 'rgba(255,255,255,0.5)', width: 1, type: 'dashed' as const },
            label: { show: true, formatter: '现价', color: 'rgba(255,255,255,0.6)', fontSize: 9, position: 'insideEndTop' as const },
          },
        ],
      },
    } : {}),
  });

  return {
    grid: { left: 8, right: 14, top: 18, bottom: 22, containLabel: true },
    xAxis: {
      type: 'value',
      min: m.xs[0], max: m.xs[m.xs.length - 1],
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, formatter: (v: number) => fmtSigned(v).replace('$', '') },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (typeof v === 'number' ? fmtSigned(v) : String(v)),
    },
    series: [lineSeg('到期盈亏', pos, UP, true), lineSeg('到期亏损', neg, DOWN, false)],
  };
}

// ── Per-leg Greek bars (Bybit values) ────────────────────────────────────────

function GreekBars({ title, sub, legs, pick, net, digits, accent }:
  { title: string; sub: string; legs: LegRow[]; pick: (l: LegRow) => number; net: number; digits: number; accent: string }) {
  const cats = legs.map(l => l.label);
  const vals = legs.map(l => {
    const v = pick(l);
    return { value: v, itemStyle: { color: v >= 0 ? UP : DOWN } };
  });
  const option: EChartsOption = {
    grid: { left: 4, right: 8, top: 6, bottom: 4, containLabel: true },
    xAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    yAxis: {
      type: 'category', data: cats, inverse: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
    },
    tooltip: {
      trigger: 'item',
      valueFormatter: (v) => (typeof v === 'number' ? v.toFixed(digits) : String(v)),
    },
    series: [{
      type: 'bar', data: vals, barWidth: '55%',
      markLine: {
        symbol: 'none', silent: true,
        lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1 },
        label: { show: false },
        data: [{ xAxis: 0 }],
      },
    }],
  };
  return (
    <div className="rounded-[8px] bg-[#111111] p-2 flex flex-col">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <span className="text-[11px] font-semibold" style={{ color: accent }}>{title}</span>
        <span className={cn('text-[11px] font-mono font-bold tnum', upDown(net))}>{net.toFixed(digits)}</span>
      </div>
      <div className="text-[9px] text-white/50 px-1 pb-1">{sub}</div>
      <div style={{ height: Math.max(96, legs.length * 26) }}>
        <EChart option={option} />
      </div>
    </div>
  );
}

// ── Demo positions ───────────────────────────────────────────────────────────
// Realistic Bybit-shaped sample rows spanning two expiries (a near-dated iron
// condor + a longer-dated bull call spread) so both the combined and "by expiry"
// views have something to show. Greeks are sample values, not live.
export const DEMO_POSITIONS: BybitOptionPosition[] = (() => {
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const tagFor = (days: number) => {
    const d = new Date(Date.now() + days * 24 * 3_600_000);
    return `${String(d.getUTCDate()).padStart(2, '0')}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
  };
  const mk = (
    days: number, K: number, type: 'C' | 'P', side: 'Buy' | 'Sell', qty: number,
    avg: number, mark: number, delta: number, gamma: number, vega: number, theta: number,
  ): BybitOptionPosition => {
    const sign = side === 'Sell' ? -1 : 1;
    return {
      symbol: `BTC-${tagFor(days)}-${K}-${type}`, side, size: qty.toString(),
      avgPrice: avg.toFixed(2), markPrice: mark.toFixed(2),
      unrealisedPnl: (sign * qty * (mark - avg)).toFixed(2),
      positionValue: (mark * qty).toFixed(2),
      delta: delta.toFixed(4), gamma: gamma.toFixed(6), vega: vega.toFixed(2), theta: theta.toFixed(2),
    };
  };
  return [
    // ── 28d iron condor ──
    mk(28, 60000, 'P', 'Buy',  0.5,  520,  430, -0.118, 0.000028, 38.4, -22.1),
    mk(28, 66000, 'P', 'Sell', 0.5, 1180, 1050, -0.262, 0.000041, 55.7, -34.8),
    mk(28, 78000, 'C', 'Sell', 0.5,  980,  860,  0.221, 0.000038, 52.3, -31.5),
    mk(28, 84000, 'C', 'Buy',  0.5,  430,  360,  0.094, 0.000024, 33.9, -19.7),
    // ── 56d bull call spread ──
    mk(56, 74000, 'C', 'Buy',  0.3, 2650, 2980,  0.430, 0.000031, 78.5, -28.4),
    mk(56, 88000, 'C', 'Sell', 0.3,  890,  760,  0.158, 0.000020, 49.2, -18.1),
  ];
})();
