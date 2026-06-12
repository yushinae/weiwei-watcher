import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import { EChart } from '../components/echart/EChart';
import type { Coin } from '../features/monitor/types';

// Black-Scholes 数学库 —— 复用共享实现。
import {
  bsGamma, bsVega, bsTheta,
} from './lib/bs-math';
// ── 共享数据层（registry/data/*）──────────────────────────────────────────────
// 监控页不再自持数据层副本：统一走全局单条 DERIBIT_WS、单份缓存与新鲜度埋点。
// 轮询 / WS 频道的生命周期由订阅引用计数 + Page Visibility 暂停自动管理
// （进入/离开 /monitor 由 widget 挂载/卸载触发订阅增减，无需路由级手动暂停）。
import { subscribeData } from './data/poller';
import { DERIBIT_WS, WS_FLUSH_MS, useOptionTradesWS } from './data/ws';
import {
  fetchDeribitOptions, useDeribitOptions,
  fetchDeribitHistory, useDeribitHistory,
  closestDeltaIV, CACHE_TTL, HIST_TTL,
} from './data/deribit';
import type {
  ParsedOption, ExpiryGroup, DeribitData, HistoryData,
} from './data/deribit';
import { useFlowData, useFuturesBasis } from './data/flow';
import { computeMaxPain, maxPain, computeNetGex } from './data/analysis';
import {
  WATCHLIST_SET, WATCH_OI_SNAP, WATCH_CACHE as WATCH_CACHE2, saveWatchlist,
} from './data/store';
import type { WatchItem } from './data/store';

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

const GRID   = 'rgba(255,255,255,0.04)';
const TXT    = '#71757A';
const BRAND  = '#24AE64';
const BLUE   = '#ff9c2e';

// ── Global SVG gradient defs (render once in MonitorPage) ─────────────────────
// Chromium / Electron: cross-SVG url() references work within the same document.
export function GlobalGradDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true"
      style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none', opacity: 0 }}>
      <defs>
        {/* vertical: colour → transparent */}
        <linearGradient id="wg-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#24AE64" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#24AE64" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-green-strong" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#24AE64" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#24AE64" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EF454A" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#EF454A" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-yellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF9C2E" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#FF9C2E" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff9c2e" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#ff9c2e" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-purple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF9C2E" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#FF9C2E" stopOpacity="0" />
        </linearGradient>
        {/* inverted (bottom → top) for short/negative fills */}
        <linearGradient id="wg-red-inv" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#EF454A" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#EF454A" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const CoinLabel = ({ coin }: { coin: Coin }) => (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--color-surface-5)] text-white/55 uppercase tracking-wider">
    {coin}
  </span>
);

// ── Live badge ────────────────────────────────────────────────────────────────

const Skeleton = () => (
  <div className="w-full h-full flex flex-col gap-2 p-3 overflow-hidden">
    {/* shimmer sweep */}
        <div className="relative flex-1 min-h-0 rounded-[10px] overflow-hidden bg-[var(--color-surface-1)]">
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
      <circle cx="10" cy="10" r="9" stroke="#EF454A" strokeWidth="1.5"/>
      <path d="M10 5.5v5M10 13.5v1" stroke="#EF454A" strokeWidth="1.5" strokeLinecap="round"/>
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
        <CoinLabel coin={coin} />
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
    <div className="overflow-hidden rounded-[18px]" style={{ backgroundColor: '#17181E' }}>
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
                      'px-2 py-1.5 text-right font-mono tnum text-white/85 font-bold transition-colors',
                      onPickCell && 'cursor-pointer hover:bg-[#3A3B40]',
                    )}
                    style={{ backgroundColor: `rgba(255,255,255,${(0.04 + (v - lo) / (hi - lo + 0.01) * 0.10).toFixed(2)})` }}
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

export const OIByStrikeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = useMemo(() => data?.expiries.slice(0, 6) ?? [], [data?.expiries]);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">Deribit</span>}
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  const spot = data?.spot ?? 0;
  const { callOI, putOI, strikes, maxPain, totalCallOI, totalPutOI } = useMemo(() => {
    // 「全部」= 全链（与决策页 computeChainLevels 同口径）；tab 只列近 6 个到期供聚焦
    const targetExps = expFilter === 'all'
      ? (data?.expiries ?? [])
      : expiries.filter(e => e.label === expFilter);
    const nextCallOI = new Map<number, number>();
    const nextPutOI  = new Map<number, number>();
    for (const e of targetExps) {
      for (const o of e.calls) {
        nextCallOI.set(o.strike, (nextCallOI.get(o.strike) ?? 0) + o.oi);
      }
      for (const o of e.puts) {
        nextPutOI.set(o.strike, (nextPutOI.get(o.strike) ?? 0) + o.oi);
      }
    }

    const allStrikes = [...new Set([...nextCallOI.keys(), ...nextPutOI.keys()])]
      .sort((a, b) => a - b);
    // 图表只画现价附近的窗口；最大痛点必须用全链 OI 算（窗口截断会丢深 ITM 的赔付贡献）
    const nextStrikes = allStrikes.filter(k => spot > 0 && k >= spot * 0.65 && k <= spot * 1.35);
    const callArr = allStrikes.map(k => ({ strike: k, oi: nextCallOI.get(k) ?? 0 }));
    const putArr  = allStrikes.map(k => ({ strike: k, oi: nextPutOI.get(k)  ?? 0 }));
    return {
      callOI: nextCallOI,
      putOI: nextPutOI,
      strikes: nextStrikes,
      maxPain: computeMaxPain(callArr, putArr, allStrikes),
      totalCallOI: [...nextCallOI.values()].reduce((s, o) => s + o, 0),
      totalPutOI: [...nextPutOI.values()].reduce((s, o) => s + o, 0),
    };
  }, [expFilter, expiries, data?.expiries, spot]);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const fmtOI = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  };
  const fmtPrice = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const chartH = Math.max(strikes.length * 32, 240);

  const option = useMemo(() => ({
    textStyle: { fontFamily: 'sans-serif' },
    grid: { left: 80, right: 12, top: 8, bottom: 12 },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 9,
        formatter: (v: number) => fmtOI(Math.abs(v)),
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: strikes.map(k => fmtPrice(k)),
      inverse: true,
      axisLabel: {
        fontSize: 9,
        color: (_v: string, i: number) => {
          const k = strikes[i];
          if (spot > 0 && Math.abs(k - spot) < spot * 0.005) return '#FF9C2E';
          if (spot > 0 && Math.abs(k - maxPain) < spot * 0.005) return 'rgba(36,174,100,0.88)';
          return 'rgba(255,255,255,0.55)';
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number; seriesName: string; value: number });
        const i = p.dataIndex;
        const k = strikes[i];
        const c = callOI.get(k) ?? 0;
        const put = putOI.get(k) ?? 0;
        const isSpot = spot > 0 && Math.abs(k - spot) < spot * 0.005;
        const isMP = spot > 0 && Math.abs(k - maxPain) < spot * 0.005;
        const marker = isSpot ? ' ◆ 现货' : isMP ? ' ★ 最大痛点' : '';
        const net = c - put;
        return `<div style="font-weight:bold;margin-bottom:4px">${fmtPrice(k)}${marker}</div>
<span style="color:#EF454A">●</span> Put OI: <b>${fmtOI(put)}</b><br/>
<span style="color:#24AE64">●</span> Call OI: <b>${fmtOI(c)}</b><br/>
<span>净: <b style="color:${net >= 0 ? '#24AE64' : '#EF454A'}">${fmtOI(Math.abs(net))}</b></span>`;
      },
    },
    series: [
      {
        name: 'Put OI',
        type: 'bar',
        data: strikes.map(k => -(putOI.get(k) ?? 0)),
        barWidth: 24,
        itemStyle: { color: 'rgba(239,69,74,0.66)', borderRadius: [2, 0, 0, 2] },
      },
      {
        name: 'Call OI',
        type: 'bar',
        data: strikes.map(k => callOI.get(k) ?? 0),
        barWidth: 24,
        itemStyle: { color: 'rgba(36,174,100,0.66)', borderRadius: [0, 2, 2, 0] },
      },
    ],
  }), [strikes, callOI, putOI, spot, maxPain]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

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
              : 'text-white/55 hover:text-white/60 hover:bg-[var(--color-surface-5)]',
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
                : 'text-white/55 hover:text-white/60 hover:bg-[var(--color-surface-5)]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex gap-2 px-3 py-2 shrink-0">
        {[
          { label: 'Call OI', val: fmtOI(totalCallOI), color: '#24AE64' },
          { label: 'Put OI', val: fmtOI(totalPutOI), color: '#EF454A' },
          { label: 'PCR', val: pcr.toFixed(2), color: pcr >= 1.2 ? '#EF454A' : pcr <= 0.7 ? '#24AE64' : '#FF9C2E' },
          { label: '最大痛点', val: maxPain.toLocaleString(), color: 'rgba(36,174,100,0.88)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[8px] px-2 py-1.5 transition-colors duration-150 ease-out hover:border-[var(--nexus-accent)]/25 hover:bg-[var(--color-surface-5)]">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[14px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/55">暂无持仓数据</div>
          : <EChart option={option} notMerge style={{ height: chartH }} />
        }
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-[var(--color-border-subtle)]">
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

export const GEXWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = useMemo(() => data?.expiries.slice(0, 6) ?? [], [data?.expiries]);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">Deribit</span>}
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setExpFilter('all'); }, [coin]);

  const spot = data?.spot ?? 0;
  const { gexMap, strikes, netGex, totalNet, zeroGamma } = useMemo(() => {
    // 「全部」= 全链（与 computeNetGex / Gamma 速读 / 决策页同口径）；tab 只列近 6 个到期
    const targetExps = expFilter === 'all' ? (data?.expiries ?? []) : expiries.filter(e => e.label === expFilter);
    const nextGexMap = new Map<number, { cGex: number; pGex: number }>();
    if (spot > 0) {
      for (const exp of targetExps) {
        for (const opt of [...exp.calls, ...exp.puts]) {
          const g = bsGamma(spot, opt.strike, opt.T, opt.iv) * spot * spot / 100;
          if (!nextGexMap.has(opt.strike)) nextGexMap.set(opt.strike, { cGex: 0, pGex: 0 });
          const e = nextGexMap.get(opt.strike)!;
          if (opt.type === 'C') e.cGex += g * opt.oi;
          else                   e.pGex += g * opt.oi;
        }
      }
    }

    const nextStrikes = [...nextGexMap.keys()]
      .filter(k => spot > 0 && k >= spot * 0.65 && k <= spot * 1.35)
      .sort((a, b) => a - b);
    // 标准 GEX 符号约定：call 正 / put 负（与 Gamma 速读 computeNetGex、决策页一致）
    const nextNetGex = nextStrikes.map(k => {
      const e = nextGexMap.get(k)!;
      return e.cGex - e.pGex;
    });

    // 净额 / 翻转点走共享 computeNetGex（窗口与本图显示窗口一致），
    // 保证速读条 / 本图 / 决策页 GEX 关键位三处数字同源
    const { totalNet, flip } = spot > 0
      ? computeNetGex({ spot, expiries: targetExps })
      : { totalNet: 0, flip: null };

    return {
      gexMap: nextGexMap,
      strikes: nextStrikes,
      netGex: nextNetGex,
      totalNet,
      zeroGamma: flip,
    };
  }, [expFilter, expiries, data?.expiries, spot]);

  const fmtGex = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return v.toFixed(0);
  };
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const chartH = Math.max(strikes.length * 32, 240);

  const option = useMemo(() => ({
    textStyle: { fontFamily: 'sans-serif' },
    grid: { left: 80, right: 12, top: 8, bottom: 12 },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: 'rgba(255,255,255,0.35)',
        fontSize: 9,
        formatter: (v: number) => fmtGex(Math.abs(v)),
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: strikes.map(k => fmtPx(k)),
      inverse: true,
      axisLabel: {
        fontSize: 9,
        color: (_v: string, i: number) => {
          const k = strikes[i];
          if (spot > 0 && Math.abs(k - spot) / spot < 0.005) return '#FF9C2E';
          if (zeroGamma !== null && Math.abs(k - zeroGamma) / spot < 0.005) return '#FF9C2E';
          return 'rgba(255,255,255,0.55)';
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number; seriesName: string; value: number });
        const i = p.dataIndex;
        const k = strikes[i];
        const net = netGex[i];
        const e = gexMap.get(k);
        const isSpot = spot > 0 && Math.abs(k - spot) / spot < 0.005;
        const isZero = zeroGamma !== null && Math.abs(k - zeroGamma) / spot < 0.005;
        const marker = isSpot ? ' ◆ 现货' : isZero ? ' ○ 零Gamma' : '';
        const cGex = e ? e.cGex : 0;   // call 正
        const pGexVal = e ? -e.pGex : 0; // put 负
        return `<div style="font-weight:bold;margin-bottom:4px">${fmtPx(k)}${marker}</div>
<span style="color:#24AE64">●</span> Call GEX: <b>${fmtGex(cGex)}</b><br/>
<span style="color:#EF454A">●</span> Put GEX: <b>${fmtGex(pGexVal)}</b><br/>
<span>净 GEX: <b style="color:${net >= 0 ? '#24AE64' : '#EF454A'}">${fmtGex(net)}</b></span>`;
      },
    },
    series: [{
      name: 'GEX',
      type: 'bar',
      data: netGex,
      barWidth: 24,
      itemStyle: {
        color: (params: unknown) =>
          (params as { value: number }).value >= 0
            ? 'rgba(36,174,100,0.66)'
            : 'rgba(239,69,74,0.66)',
        borderRadius: (params: unknown) =>
          (params as { value: number }).value >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2],
      },
    }],
  }), [gexMap, strikes, netGex, spot, zeroGamma]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/55">暂无数据</div>;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry filter */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
        {['all', ...expiries.map(e => e.label)].map(f => (
          <button key={f} onClick={() => setExpFilter(f as 'all' | string)}
            className={cn('px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0',
              expFilter === f
                ? 'bg-[var(--nexus-accent)]/15 text-[var(--nexus-accent)]'
                : 'text-white/55 hover:text-white/60 hover:bg-[var(--color-surface-5)]'
            )}>
            {f === 'all' ? '全部' : f}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex gap-2 px-3 py-2 shrink-0">
        {[
          { label: '净 GEX', val: fmtGex(totalNet), color: totalNet >= 0 ? '#24AE64' : '#EF454A' },
          { label: '零 Gamma', val: zeroGamma ? fmtPx(zeroGamma) : '—', color: '#FF9C2E' },
          { label: '现货', val: fmtPx(spot), color: 'rgba(255,255,255,0.6)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[8px] px-2 py-1.5 transition-colors duration-150 ease-out hover:border-[var(--nexus-accent)]/25 hover:bg-[var(--color-surface-5)]">
            <div className="text-[9px] text-white/55 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[14px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* GEX chart */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3">
        <EChart option={option} notMerge style={{ height: chartH }} />
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-[var(--color-border-subtle)]">
        ◆ 现货  ○ 零Gamma  GEX = Γ × OI × S² / 100（每1%标的波动）· Deribit
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════��══════════════
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
          { label: 'VRP', val: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}%`, color: vrp >= 0 ? '#24AE64' : '#EF454A' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[8px] px-2 py-1.5">
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
  const fundColor = data.currentFunding8h >= 0 ? '#24AE64' : '#EF454A';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        {[
          { label: '当前 8H 费率', val: fmtRate(data.currentFunding8h), color: fundColor },
          { label: '年化费率', val: `${data.annFunding >= 0 ? '+' : ''}${data.annFunding.toFixed(1)}%`, color: fundColor },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[8px] px-2 py-1.5">
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
          <path d={posArea} fill="rgba(36,174,100,0.08)" />
          {/* Negative fill */}
          <path d={negArea} fill="rgba(239,69,74,0.08)" />
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
  const basis = useFuturesBasis(coin);
  const { setHeaderRight } = useCardHeader();
  const live = basis.length > 0;

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {live && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, live]);

  if (!basis.length) return <Skeleton />;

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
          const color = b.annBasis >= 0 ? 'rgba(36,174,100,0.66)' : 'rgba(239,69,74,0.66)';
          const px = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);
          return (
            <div key={i} className="flex items-center gap-3 py-1 border-b border-[var(--color-border-subtle)] last:border-0">
              <div className="w-[72px] shrink-0">
                <div className="text-[11px] font-mono font-semibold text-white/70">{b.label}</div>
                <div className="text-[9px] text-white/55">{b.daysToExp}天 · ${px(b.futurePx)}</div>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-[8px] bg-[var(--color-surface-1)] rounded-full overflow-hidden">
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
  const sentiment = callPct > 55 ? { label: '看涨偏向', color: '#24AE64' }
                  : callPct < 45 ? { label: '看跌偏向', color: '#EF454A' }
                  : { label: '中性', color: '#FF9C2E' };

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
          { label: 'Call 成交量', val: fmtVol(callVol), color: '#24AE64' },
          { label: 'Put 成交量', val: fmtVol(putVol), color: '#EF454A' },
          { label: 'P/C 比', val: volRatio.toFixed(2), color: '#FF9C2E' },
          { label: '方向', val: sentiment.label, color: sentiment.color },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[8px] px-2 py-1.5">
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
          <div className="flex h-[6px] rounded-full overflow-hidden bg-[var(--color-surface-1)]">
          <div className="h-full bg-[#24AE64]/70 transition-all" style={{ width: `${callPct}%` }} />
          <div className="h-full bg-[#EF454A]/70 flex-1" />
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
              <div className="flex-1 flex h-[12px] rounded-[3px] overflow-hidden bg-[var(--color-surface-1)]" style={{ maxWidth: `${barTotal}%` }}>
                <div className="h-full bg-[#24AE64]/60" style={{ width: `${cPct}%` }} />
                <div className="h-full bg-[#EF454A]/60 flex-1" />
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
      <div className="grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-[var(--color-border-subtle)]">
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
          {filtered.map(t => {
            const isBuy = t.direction === 'buy';
            const dirColor = isBuy ? '#24AE64' : '#EF454A';
            const typeColor = t.optType === 'C' ? '#ff9c2e' : '#FF9C2E';
            const sizeEmphasis = t.notionalUSD >= 1_000_000;
            return (
              <div
                key={t.tradeId}
                className={cn(
                  'row-track grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-2 border-b border-[var(--color-border-subtle)]',
                  // 新单入场橙光衰减；只给 10s 内的成交,避免初次加载整列泛橙
                  Date.now() - t.ts < 10_000 && 'row-enter',
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

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-[var(--color-border-subtle)]">
        名义金额 = 合约数 × 指数价格 · 仅显示 ≥ {fmtUSD(minUSD)} 的成交 · Deribit
      </div>
    </div>
  );
};

// SkewHistoryWidget removed — session-only, always empty on page load

// ═══════════════════════════════════════════════════════════════════════════════
// VannaCharmWidget — 高阶 Greeks 热力图（Strike × Expiry）
// ═══════════════════════════════════════════════════════════════════════════════


export const ExpiryCalendarWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--nexus-green)]/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-[var(--nexus-green)]/80 animate-pulse" />实时</span>}
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
      <div className="grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-[var(--color-border-subtle)]">
        {['到期日', 'OI 分布（Call ▶ ◀ Put）', 'PCR', 'ATM IV', 'Max Pain', '偏离现货'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((r, i) => {
          const callBarW = maxOI > 0 ? (r.callOI / maxOI) * (BAR_MAX / 2) : 0;
          const putBarW  = maxOI > 0 ? (r.putOI  / maxOI) * (BAR_MAX / 2) : 0;
          const pcrColor2 = r.pcr >= 1.2 ? '#EF454A' : r.pcr <= 0.7 ? '#24AE64' : '#FF9C2E';
          const mpColor   = r.mpPct >= 3 ? '#24AE64' : r.mpPct <= -3 ? '#EF454A' : 'rgba(255,255,255,0.4)';
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
                    style={{ width: `${callBarW}px`, background: 'rgba(36,174,100,0.52)' }}
                  />
                </div>
                {/* Centre spine */}
                <div className="w-px h-[12px] bg-white/10" />
                {/* Put bar (grows right) */}
                <div className="flex justify-start" style={{ width: `${BAR_MAX / 2}px` }}>
                  <div
                    className="h-[10px] rounded-r-[3px] transition-all"
                    style={{ width: `${putBarW}px`, background: 'rgba(239,69,74,0.52)' }}
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
          <div className="px-3 py-1.5 shrink-0 border-t border-[var(--color-border-subtle)] flex items-center gap-4">
        <span className="text-[9px] text-white/55">
          Max Pain = 期权卖方总损失最小的到期价
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(36,174,100,0.52)]" />
            <span className="text-[9px] text-white/55">Call OI</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(239,69,74,0.52)]" />
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

export const ImpliedMoveWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <CoinLabel coin={coin} />
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
    // T(年) = daysToExp/365；ExpiryGroup 没有 T 字段（之前用 e.T → undefined → NaN）
    const movePct = (e.atmIV / 100) * Math.sqrt(e.daysToExp / 365) * SQRT_2_PI * 100;
    const upTarget   = data.spot * (1 + movePct / 100);
    const downTarget = data.spot * (1 - movePct / 100);
    return { label: e.label, movePct, atmIV: e.atmIV, upTarget, downTarget, daysToExp: e.daysToExp };
  });

  const maxMove = Math.max(...rows.map(r => r.movePct), 1);
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-wrap md:flex-nowrap items-stretch content-start md:content-stretch gap-1.5 px-3 py-2 overflow-y-auto md:overflow-x-auto md:overflow-y-hidden">
      {rows.map(r => {
        const barFill = (r.movePct / maxMove) * 100;
        const urgency = r.daysToExp <= 7 ? '#FF9C2E' : r.daysToExp <= 30 ? '#24AE64' : '#ff9c2e';
        return (
          <div key={r.label}
            className="flex-1 min-w-[96px] flex flex-col justify-between bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[10px] px-2.5 py-2 shrink-0"
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
              <span style={{ color: '#24AE64' }}>↑${fmtPx(r.upTarget)}</span>
              <span style={{ color: '#EF454A' }}>↓${fmtPx(r.downTarget)}</span>
            </div>

            {/* Bar proportional to move size */}
            <div className="h-[3px] rounded-full overflow-hidden bg-[var(--color-surface-1)]">
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
        <CoinLabel coin={coin} />
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
      color: netDollarDelta >= 0 ? '#24AE64' : '#EF454A',
      tip: 'OI加权净Delta，>0市场整体偏多',
    },
    {
      label: '$Vega / 1% IV',
      val: `${sign(dollarVega)}${fmtM(dollarVega)}`,
      sub: '全市场 IV 涨 1% 的盈亏',
      color: '#ff9c2e',
      tip: '隐含波动率每涨1%全体OI的价值变化',
    },
    {
      label: '$Θ / 天',
      val: `${fmtM(dollarTheta)}`,
      sub: '每日时间价值消耗',
      color: '#EF454A',
      tip: '每过一个自然日市场OI总时间价值衰减',
    },
    {
      label: '$Γ / 1% 现货',
      val: `${sign(dollarGamma)}${fmtM(dollarGamma)}`,
      sub: dollarGamma >= 0 ? '正Gamma — 稳定' : '负Gamma — 加速',
      color: dollarGamma >= 0 ? '#24AE64' : '#FF9C2E',
      tip: '现货每涨1%时Delta变化引起的美元敞口',
    },
  ];

  return (
    <div className="w-full h-full flex flex-wrap md:flex-nowrap items-stretch content-start md:content-stretch gap-2 px-3 py-2 overflow-y-auto md:overflow-y-hidden">
      {stats.map(s => (
        <div key={s.label}
          className="flex-1 min-w-[150px] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[10px] px-3 py-2.5 flex flex-col justify-between transition-colors hover:border-[var(--nexus-accent)]/25"
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
        <CoinLabel coin={coin} />
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
    if (Math.abs(pct) < 1) return { label: 'ATM', color: '#FF9C2E' };
    if (pct > 0) return { label: `OTM +${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
    return { label: `OTM ${pct.toFixed(0)}%`, color: 'rgba(255,255,255,0.3)' };
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="grid grid-cols-[40px_60px_56px_48px_56px_56px_1fr] gap-x-2 px-3 py-1.5 shrink-0 border-b border-[var(--color-border-subtle)]">
        {['#', '行权价', '到期', '类型', 'IV', 'Delta', sortBy === 'oi' ? '持仓量 OI' : '成交量 Vol'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/55">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map((o, i) => {
          const val = sortBy === 'oi' ? o.oi : o.volume;
          const barW = (val / maxVal) * 100;
          const typeColor = o.type === 'C' ? '#ff9c2e' : '#FF9C2E';
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
                <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-[var(--color-surface-1)]">
                  <div className="h-full rounded-full" style={{ width: `${barW}%`, background: typeColor, opacity: 0.6 }} />
                </div>
                <span className="font-mono text-[10px] text-white/50 shrink-0 w-[36px] text-right">{fmtN(val)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/55 shrink-0 border-t border-[var(--color-border-subtle)]">
        按{sortBy === 'oi' ? '持仓量' : '成交量'}排序 · 全到期日 · Deribit
      </div>
    </div>
  );
};

// TermStructureDriftWidget removed — session-only, always empty on page load

// ═══════════════════════════════════════════════════════════════════════════════
// StrategyPricerWidget — ATM Straddle / 25δ Strangle 快速定价
// ═══════════════════════════════════════════════════════════════════════════════

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
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.100ms`, (d) => {
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
                className="row-track grid items-center px-3 py-1.5 border-b border-white/4"
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
const CONE_TENORS = [7, 14, 30, 60, 90, 180];

export const IVCheapnessWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [opt, setOpt]     = useState<DeribitData | null>(null);
  const [hist, setHist]   = useState<HistoryData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [timedOut, setTimedOut]   = useState(false);
  const gotOptRef = useRef(false);
  const gotHistRef = useRef(false);

  useEffect(() => {

    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    let gotOpt = false;
    let gotHist = false;
    setLoading(true);
    setTimedOut(false);
    gotOptRef.current = false;
    gotHistRef.current = false;
    const timeout = setTimeout(() => { if (alive && (!gotOptRef.current || !gotHistRef.current)) setTimedOut(true); }, 20_000);
    const u1 = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (!alive) return; gotOptRef.current = true; setOpt(d); gotOpt = true; if (gotHist) setLoading(false); },
    );
    const u2 = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => { if (!alive) return; gotHistRef.current = true; setHist(d); gotHist = true; setTimedOut(false); if (gotOpt) setLoading(false); },
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
    'very-cheap':     { bg: 'rgba(37,167,80,0.25)',   text: '#24AE64', label: '极便宜' },
    'cheap':          { bg: 'rgba(37,167,80,0.12)',   text: '#24AE64', label: '便宜'   },
    'fair':           { bg: 'rgba(255,255,255,0.04)', text: '#9a9a9a', label: '合理'   },
    'expensive':      { bg: 'rgba(239,69,74,0.08)',   text: '#EF454A', label: '偏贵'   },
    'very-expensive': { bg: 'rgba(239,69,74,0.16)',   text: '#EF454A', label: '极贵'   },
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
