import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import { EChart } from '../components/echart/EChart';
import type { Coin } from '../features/monitor/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Black-Scholes + AR(1) from lib/bs-math.ts
// ═══════════════════════════════════════════════════════════════════════════════
export {
  normCDF, normPDF,
  bsDelta, bsGamma, bsVanna, bsCharm, bsVega, bsTheta, bsCall, bsPut,
  fitAR1, forecastAR1,
  heatColor,
} from './lib/bs-math';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: color tokens + IVR/PCR helpers from lib/widget-colors.ts
// ═══════════════════════════════════════════════════════════════════════════════
export {
  GRID, TXT, BRAND, RED, YELLOW, BLUE, PURPLE,
  ivrColor, ivrLabel, pcrColor, pcrLabel,
} from './lib/widget-colors';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: UI atoms from components/widget-atoms.tsx
// ═══════════════════════════════════════════════════════════════════════════════
export { CoinTabs, LiveBadge, Skeleton, HistLoadErr } from './components/widget-atoms';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Poller infrastructure from data/poller.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type { DataSub } from './data/poller';
export { _shouldSkip, setVisibleInterval, subscribeData } from './data/poller';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Deribit types + data layer from data/deribit.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type {
  ParsedOption, ExpiryGroup, DeribitData,
  VolConeSlice, HistoryData,
} from './data/deribit';
export {
  parseDeribitExpiry, closestDeltaIV, processDeribitResponse,
  DERIBIT_CACHE, CACHE_TTL, HIST_CACHE, HIST_TTL,
  rollingRV, percentileAt,
  fetchDeribitOptions, useDeribitOptions,
  fetchDeribitHistory, useDeribitHistory,
} from './data/deribit';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: WebSocket layer from data/ws.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type {
  RawOptionTrade, TickerSnapshot, OBEntry, BlockTrade,
} from './data/ws';
export {
  DeribitWS, DERIBIT_WS, WS_FLUSH_MS,
  TICKER_CACHE,
  useTickerSnapshotWS, useOptionTradesWS, useOrderbookWS,
  useDualHistory,
} from './data/ws';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Flow data from data/flow.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type {
  FundingPoint, BasisPoint, FearGreedPoint, FlowData,
} from './data/flow';
export {
  FLOW_CACHE, FLOW_TTL,
  MONTH_MAP_FUTURES, parseFuturesExpiry,
  fetchFlowData, useFlowData, useFearGreed,
} from './data/flow';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Analysis from data/analysis.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type {
  SignalSeverity, IVSignal,
  VolRegime, RegimeResult,
  SentFactor,
} from './data/analysis';
export {
  computeMaxPain, maxPain,
  FG_ZONES, fgColor,
  severityColor, severityBg, severityBorder,
  generateSignals,
  classifyRegime,
  clamp01, computeSentiment,
  parseInstForPayoff,
} from './data/analysis';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Store from data/store.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type {
  PFlowAcc,
  WatchItem,
  UserPosition, LivePosition,
  AlertMetric, AlertOp, UserAlert,
} from './data/store';
export {
  PFLOW_ACC, PFLOW_SERIES, PFLOW_LAST, processPremiumFlow,
  LARGE_BUF, LARGE_SEEN_IDS, processLargeTrades,
  loadWatchlist, saveWatchlist, WATCHLIST_SET, WATCH_OI_SNAP, WATCH_CACHE,
  loadPositions, savePositions, POS_STORE, POS_TICKER_CACHE, buildLiveFromCache,
  subscribePositions, addPosition, removePositionById,
  loadAlerts, saveAlerts, ALERTS_STORE, METRIC_META, evalAlerts,
} from './data/store';

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export: Chart utilities from lib/chart-utils.ts
// ═══════════════════════════════════════════════════════════════════════════════
export type { SmileRow } from './lib/chart-utils';
export {
  SMILE_GRID, SMILE_LABELS_LIVE, buildSmileRows,
  pickExpiries,
  dailyReturns, rollingCorr,
} from './lib/chart-utils';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const CONE_TENOR_TARGETS = [7, 14, 30, 60, 90, 180];

export const SURFACE_ROWS: { label: string; type: 'C' | 'P'; delta: number }[] = [
  { label: '10P', type: 'P', delta: 0.10 },
  { label: '25P', type: 'P', delta: 0.25 },
  { label: 'ATM', type: 'C', delta: 0.50 },
  { label: '25C', type: 'C', delta: 0.25 },
  { label: '10C', type: 'C', delta: 0.10 },
];

export const BT_MIN_USD = 50_000;

export const SCEN_SPOT = [-15, -10, -7, -5, -3, -1, 0, 1, 3, 5, 7, 10, 15];
export const SCEN_IV   = [-20, -10, -5, 0, 5, 10, 20];

export const PROB_STRIKE_OFFSETS = [-0.20, -0.15, -0.10, -0.07, -0.04, 0, +0.04, +0.07, +0.10, +0.15, +0.20];

export const RV_IV_TENORS = [7, 14, 30, 60, 90, 180] as const;
export const CONE_TENORS = [7, 14, 30, 60, 90, 180];

export type SpreadType = 'bull-call' | 'bear-put' | 'risk-reversal';

// ═══════════════════════════════════════════════════════════════════════════════
// useCoinControl + WidgetShell
// ═══════════════════════════════════════════════════════════════════════════════

export type CoinControlProps = { coin?: Coin; onCoinChange?: (c: Coin) => void };

export function useCoinControl({ coin: coinProp, onCoinChange }: CoinControlProps) {
  const isControlled = coinProp !== undefined;
  const [localCoin, setLocalCoin] = useState<Coin>(coinProp ?? 'BTC');
  const coin = coinProp ?? localCoin;
  const onCoinChangeRef = useRef(onCoinChange);
  useEffect(() => { onCoinChangeRef.current = onCoinChange; }, [onCoinChange]);
  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;
  const setCoin = useCallback((c: Coin) => {
    // Controlled: parent owns the state — only notify, don't double-setState.
    // Uncontrolled: maintain local state.
    if (!isControlledRef.current) setLocalCoin(c);
    onCoinChangeRef.current?.(c);
  }, []);
  return { coin, setCoin };
}

import {
  SMILE_GRID, SMILE_LABELS_LIVE, buildSmileRows,
} from './lib/chart-utils';
import { TXT, BRAND, YELLOW, BLUE } from './lib/widget-colors';

export const WidgetShell = ({ children, coin, setCoin }: { children: React.ReactNode; coin: Coin; setCoin: (c: Coin) => void }) => {
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">
        {coin}
      </span>
    );
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

import { CoinTabs, Skeleton } from './components/widget-atoms';

// ═══════════════════════════════════════════════════════════════════════════════
// Chart components
// ═══════════════════════════════════════════════════════════════════════════════

import type { ExpiryGroup, VolConeSlice } from './data/deribit';

export const SmileChartLive = React.memo(({
  expiries,
  onPick,
}: {
  expiries: ExpiryGroup[];
  onPick?: (p: { tenor: string; label: string; value: number }) => void;
}) => {
  if (!expiries.length) return <Skeleton />;
  const { rows, lines } = buildSmileRows(expiries);
  const allIVs = rows.flatMap(r => r.values).filter(v => v > 0);
  if (!allIVs.length) return <Skeleton />;

  const option = {
    legend: {
      data: lines.map(l => ({ name: l.label, icon: 'roundRect', itemStyle: { color: l.color } })),
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      right: 12, top: 4,
    },
    xAxis: {
      type: 'category',
      data: [...SMILE_LABELS_LIVE],
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 'bold' },
      axisTick: { show: false },
      boundaryGap: false,
      axisPointer: {
        show: true,
        label: { backgroundColor: 'rgba(37,232,137,0.85)', color: '#0a0e14', fontWeight: 'bold' },
      },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => `${v.toFixed(0)}%` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: lines.map((line, li) => ({
      name: line.label,
      type: 'line' as const,
      smooth: 0.3,
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { color: line.color, width: 1.8 },
      itemStyle: { color: line.color, borderColor: '#0a0e14', borderWidth: 1.5 },
      label: {
        show: true,
        position: 'top' as const,
        fontSize: 9,
        color: line.color,
        formatter: (p: { value: number }) => p.value.toFixed(1),
      },
      emphasis: { focus: 'series' as const, scale: 1.3 },
      data: rows.map(r => +(r.values[li] || 0).toFixed(2)),
    })),
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ seriesName: string; value: number; color: string; axisValue: string }>) => {
        const head = `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>`;
        const lines = params
          .map(p => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${p.value.toFixed(2)}%</b>`)
          .join('<br/>');
        return head + lines;
      },
    },
    grid: { left: 40, right: 14, top: 32, bottom: 28 },
  };

  const onEvents = onPick ? {
    click: (p: { seriesName?: string; name?: string; value?: number }) => {
      if (p.seriesName && p.name && typeof p.value === 'number') {
        onPick({ tenor: p.seriesName, label: p.name, value: p.value });
      }
    },
  } : undefined;

  return <EChart option={option} onEvents={onEvents} />;
});

export const VRPChart = React.memo(({ data: d }: { data: { iv: number; rv: number }[] }) => {
  if (!d.length) return <Skeleton />;
  const n = d.length;
  const xLabels = d.map((_, i) => `T-${n - 1 - i}D`);
  const ivSeries = d.map(r => +r.iv.toFixed(2));
  const rvSeries = d.map(r => +r.rv.toFixed(2));

  const option = {
    legend: {
      data: [
        { name: 'IV', icon: 'roundRect', itemStyle: { color: BRAND } },
        { name: 'RV', icon: 'roundRect', itemStyle: { color: YELLOW } },
      ],
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      right: 12, top: 0,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, interval: Math.max(0, Math.floor(n / 8)) },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      { name: 'IV', type: 'line', smooth: 0.25, showSymbol: false,
        lineStyle: { color: BRAND, width: 1.6 },
        areaStyle: { color: 'rgba(37,232,137,0.10)' },
        data: ivSeries },
      { name: 'RV', type: 'line', smooth: 0.25, showSymbol: false,
        lineStyle: { color: YELLOW, width: 1.2, type: 'dashed' as const },
        data: rvSeries },
    ],
    tooltip: {
      valueFormatter: (v: number | string) =>
        typeof v === 'number' ? `${v.toFixed(1)}%` : String(v),
    },
    grid: { left: 36, right: 12, top: 24, bottom: 22 },
  };

  return <EChart option={option} />;
});

export const IVRankChart = React.memo(({ data: d }: { data: number[] }) => {
  if (!d.length) return <Skeleton />;
  const n = d.length;
  const xLabels = d.map((_, i) => `T-${n - 1 - i}D`);

  const option = {
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, interval: Math.max(0, Math.floor(n / 10)) },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      min: 0, max: 100,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => `${v}` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    dataZoom: [{ type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseWheel: false }],
    series: [{
      name: 'IV Rank',
      type: 'line', smooth: 0.25, showSymbol: false,
      lineStyle: { color: BRAND, width: 1.6 },
      areaStyle: { color: 'rgba(37,232,137,0.10)' },
      data: d.map(v => +v.toFixed(1)),
      markLine: {
        symbol: 'none',
        lineStyle: { type: 'dashed', width: 1 },
        label: { color: 'rgba(255,255,255,0.4)', fontSize: 9, position: 'insideEndTop' },
        data: [
          { yAxis: 30, lineStyle: { color: 'rgba(37,232,137,0.45)' },  label: { formatter: '低 30' } },
          { yAxis: 70, lineStyle: { color: 'rgba(202,63,100,0.45)' }, label: { formatter: '高 70' } },
        ],
      },
    }],
    tooltip: {
      valueFormatter: (v: number | string) =>
        typeof v === 'number' ? `${v.toFixed(0)} %ile` : String(v),
    },
    grid: { left: 32, right: 12, top: 16, bottom: 22 },
  };

  return <EChart option={option} />;
});

export const VolConeChart = React.memo(({
  cone,
  currIVs,
  tenorLabels,
}: {
  cone: VolConeSlice;
  currIVs: number[];
  tenorLabels: string[];
}) => {
  const allVals = [...cone.p90, ...currIVs].filter(v => v > 0);
  if (!allVals.length) return <Skeleton />;

  const boxData = cone.tenors.map((_, i) => [
    +cone.p10[i].toFixed(2),
    +cone.p25[i].toFixed(2),
    +cone.p50[i].toFixed(2),
    +cone.p75[i].toFixed(2),
    +cone.p90[i].toFixed(2),
  ]);
  const xLabels = cone.tenors.map((d, i) => tenorLabels[i] ?? `${d}D`);

  const option = {
    legend: {
      data: [
        { name: '历史 RV 区间', icon: 'roundRect', itemStyle: { color: 'rgba(37,232,137,0.5)' } },
        { name: '当前 IV',     icon: 'roundRect', itemStyle: { color: YELLOW } },
      ],
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      right: 12, top: 0,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 'bold' },
      axisTick: { show: false },
      boundaryGap: true,
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: '历史 RV 区间',
        type: 'boxplot',
        data: boxData,
        itemStyle: {
          color: 'rgba(37,232,137,0.18)',
          borderColor: 'rgba(37,232,137,0.7)',
          borderWidth: 1.2,
        },
        boxWidth: [14, 22],
      },
      {
        name: '当前 IV',
        type: 'line',
        smooth: 0.2,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: YELLOW, width: 1.6 },
        itemStyle: { color: YELLOW, borderColor: '#0a0e14', borderWidth: 1.5 },
        label: { show: true, position: 'top' as const, fontSize: 9, color: YELLOW, formatter: (p: { value: number }) => p.value.toFixed(0) },
        data: currIVs.map(v => +v.toFixed(2)),
      },
    ],
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ seriesType: string; seriesName: string; axisValue: string; data: unknown; color: string }>) => {
        const head = `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>`;
        const lines = params.map(p => {
          if (p.seriesType === 'boxplot') {
            const v = p.data as [unknown, number, number, number, number, number];
            const [, lo, q1, mid, q3, hi] = v;
            return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${lo.toFixed(0)}–${hi.toFixed(0)}</b> (中位 ${mid.toFixed(0)})`;
          }
          const v = (p.data as number) ?? 0;
          return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${v.toFixed(1)}%</b>`;
        });
        return head + lines.join('<br/>');
      },
    },
    grid: { left: 32, right: 12, top: 24, bottom: 24 },
  };

  return <EChart option={option} />;
});

// ═══════════════════════════════════════════════════════════════════════════════
// useBlockTrades
// ═══════════════════════════════════════════════════════════════════════════════

import type { RawOptionTrade } from './data/ws';
import { useOptionTradesWS } from './data/ws';

export function useBlockTrades(coin: Coin, minUSD = BT_MIN_USD) {
  const allTrades = useOptionTradesWS(coin);
  const trades = useMemo<RawOptionTrade[]>(() =>
    allTrades
      .filter(t => t.notionalUSD >= minUSD)
      .slice(0, 120)
      .map(t => ({
        id: t.id, instrument: t.instrument,
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
// Periodic cache cleanup — call startCacheCleanup() once from App.tsx
// ═══════════════════════════════════════════════════════════════════════════════

import { DERIBIT_CACHE, CACHE_TTL, HIST_CACHE, HIST_TTL } from './data/deribit';
import { FLOW_CACHE, FLOW_TTL } from './data/flow';
import { TICKER_CACHE } from './data/ws';
import { WATCH_CACHE } from './data/store';

const CLEANUP_MS = 300_000;

function _cleanExpired<K>(map: Map<K, { ts: number }>, ttl: number): void {
  const cutoff = Date.now() - ttl;
  for (const [k, v] of map) { if (v.ts < cutoff) map.delete(k); }
}

export function startCacheCleanup(): () => void {
  const id = setInterval(() => {
    if (document.hidden) return;
    _cleanExpired(DERIBIT_CACHE, CACHE_TTL);
    _cleanExpired(HIST_CACHE, HIST_TTL);
    _cleanExpired(FLOW_CACHE, FLOW_TTL);
    _cleanExpired(TICKER_CACHE, 300_000);
    _cleanExpired(WATCH_CACHE, 600_000);
  }, CLEANUP_MS);
  return () => clearInterval(id);
}
