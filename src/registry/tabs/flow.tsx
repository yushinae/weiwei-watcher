import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../lib/utils";
import { useCardHeader } from "../../components/card/WidgetCard";
import { EChart } from "../../components/echart/EChart";
import type { Coin } from "../../features/monitor/types";
import {
  VOL_CONE,
  VRP_HIST, IVR_HIST,
  VOL,
} from "../../features/monitor/data/mock";

// Types
import type {
  CoinControlProps,
  ParsedOption, ExpiryGroup, DeribitData, HistoryData, VolConeSlice,
  BlockTrade, FundingPoint, BasisPoint, FearGreedPoint, FlowData,
  SignalSeverity, IVSignal, VolRegime, RegimeResult,
  TickerSnapshot, OBEntry, RawOptionTrade, PFlowAcc, WatchItem, SentFactor,
  UserPosition, LivePosition, UserAlert, AlertMetric, AlertOp, SpreadType,
} from "../monitorWidgetsBase";

// Values
import {
  useCoinControl, CoinTabs, LiveBadge, Skeleton, HistLoadErr,
  useDeribitOptions, useDeribitHistory, DERIBIT_WS,
  normCDF, normPDF, bsGamma, bsVanna, bsCharm, bsDelta, bsVega, bsTheta,
  bsCall, bsPut, fitAR1, forecastAR1,
  GRID, TXT, BRAND, RED, YELLOW, BLUE, PURPLE,
  heatColor, parseDeribitExpiry, closestDeltaIV, processDeribitResponse,
  fetchDeribitOptions, fetchDeribitHistory, subscribeData, HIST_TTL,
  DERIBIT_CACHE, HIST_CACHE, CACHE_TTL, _shouldSkip, WS_FLUSH_MS, setVisibleInterval,
  pickExpiries, WidgetShell,
  ivrColor, ivrLabel, pcrColor, pcrLabel,
  SmileChartLive, VRPChart, IVRankChart, VolConeChart,
  buildSmileRows, SMILE_GRID, SMILE_LABELS_LIVE,
  CONE_TENOR_TARGETS, SURFACE_ROWS, computeMaxPain,
  BT_MIN_USD, useBlockTrades,
  FLOW_CACHE, FLOW_TTL, MONTH_MAP_FUTURES, parseFuturesExpiry, fetchFlowData,
  useFlowData, useFearGreed, FG_ZONES, fgColor,
  severityColor, severityBg, severityBorder, generateSignals,
  maxPain, RV_IV_TENORS, useDualHistory,
  classifyRegime,
  PROB_STRIKE_OFFSETS,
  TICKER_CACHE, useTickerSnapshotWS,
  useOptionTradesWS, useOrderbookWS,
  SCEN_SPOT, SCEN_IV,
  PFLOW_ACC, PFLOW_SERIES, PFLOW_LAST, processPremiumFlow,
  LARGE_BUF, LARGE_SEEN_IDS, processLargeTrades,
  dailyReturns, rollingCorr,
  loadWatchlist, saveWatchlist, WATCHLIST_SET, WATCH_OI_SNAP, WATCH_CACHE,
  clamp01, computeSentiment,
  // Position tracker & alerts
  loadPositions, POS_STORE, POS_TICKER_CACHE, buildLiveFromCache, savePositions,
  loadAlerts, ALERTS_STORE, saveAlerts, METRIC_META, evalAlerts,
  parseInstForPayoff,
  CONE_TENORS,
} from "../monitorWidgetsBase";
export const FundingRateWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
  const n = pts.length;
  const xLabels = pts.map((_, i) => `T-${n - 1 - i}`);
  const rateData = pts.map(p => +p.rate.toFixed(4));
  const fmtRate = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(4)}%`;
  const fundColor = data.currentFunding8h >= 0 ? '#25e889' : '#FF5F57';

  const option = {
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
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}%` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [{
      name: '资金费率',
      type: 'line', smooth: 0.25, showSymbol: false,
      lineStyle: { color: fundColor, width: 1.6 },
      // Diverging fill: positive = green (longs paying), negative = red.
      areaStyle: {
        origin: 'start',
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0,   color: 'rgba(37,232,137,0.18)' },
            { offset: 0.5, color: 'rgba(37,232,137,0.04)' },
            { offset: 0.5, color: 'rgba(248,113,113,0.04)' },
            { offset: 1,   color: 'rgba(248,113,113,0.18)' },
          ],
        },
      },
      data: rateData,
      markLine: {
        symbol: 'none',
        silent: true,
        lineStyle: { color: 'rgba(255,255,255,0.12)', type: 'solid', width: 1 },
        data: [{ yAxis: 0 }],
      },
    }],
    tooltip: {
      valueFormatter: (v: number | string) => typeof v === 'number' ? fmtRate(v) : String(v),
    },
    grid: { left: 50, right: 12, top: 18, bottom: 22 },
  };

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
      <div className="flex-1 min-h-0 px-2">
        <EChart option={option} />
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        8小时资金费率（正值 = 多头付空头）· {coin}-PERPETUAL · Deribit
      </div>
    </div>
  );
});
export const FuturesBasisWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useFlowData(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.basis.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无期货数据</div>
  );

  const { basis } = data;
  const px = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  // Horizontal bar per expiry, sign-coloured. Expiry labels show days + futures price.
  const yLabels = basis.map(b => `${b.label}  ${b.daysToExp}D`);
  const values = basis.map(b => +b.annBasis.toFixed(2));
  const futPx  = basis.map(b => b.futurePx);
  const chartHeight = Math.max(160, basis.length * 30 + 40);

  const option = {
    grid: { left: 90, right: 60, top: 8, bottom: 22, containLabel: false },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'ui-monospace, monospace' },
    },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: Array<{ axisValue: string; value: number; color: string; dataIndex: number }>) => {
        const idx = params[0].dataIndex;
        const v = values[idx];
        const col = v >= 0 ? '#25e889' : '#FF5F57';
        return `<div style="font-weight:bold;margin-bottom:4px">${basis[idx].label} · ${basis[idx].daysToExp}天</div>` +
               `<span style="color:${col}">●</span> 年化基差: <b>${v >= 0 ? '+' : ''}${v.toFixed(1)}%</b><br/>` +
               `期货价: <b>$${px(futPx[idx])}</b>`;
      },
    },
    series: [{
      type: 'bar' as const,
      barWidth: '55%',
      data: values.map(v => ({
        value: v,
        itemStyle: {
          color: v >= 0 ? 'rgba(37,232,137,0.7)' : 'rgba(248,113,113,0.7)',
          borderRadius: v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
        },
      })),
      label: {
        show: true,
        position: 'right' as const,
        fontSize: 10,
        fontWeight: 'bold',
        color: (p: { value: number }) => (p.value >= 0 ? '#25e889' : '#FF5F57'),
        formatter: (p: { value: number }) => `${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}%`,
      },
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-auto">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <span className="text-[10px] font-bold text-white/25 uppercase tracking-wider">年化基差（期货 vs 现货）</span>
      </div>
      <div className="flex-1 min-h-0 px-2">
        <div style={{ width: '100%', height: chartHeight }}>
          <EChart option={option} />
        </div>
      </div>
      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        (期货价 / 现货价 − 1) × (365 / 剩余天数) · Deribit
      </div>
    </div>
  );
});
export const OptionsFlowWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Call/Put ratio bar */}
      <div className="px-3 pb-2 shrink-0">
        <div className="flex items-center justify-between text-[9px] text-white/45 mb-1">
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
        <div className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">按到期日拆分</div>
        {expVol.map((e, i) => {
          const total = e.callV + e.putV;
          const cPct = total > 0 ? (e.callV / total) * 100 : 50;
          const barTotal = (total / maxExpVol) * 100;
          return (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <div className="w-[32px] text-[10px] font-mono text-white/50 shrink-0">{e.label}</div>
              <div className="flex-1 flex h-[12px] rounded-[3px] overflow-hidden bg-white/[0.04]" style={{ maxWidth: `${barTotal}%` }}>
                <div className="h-full bg-[#25e889]/60" style={{ width: `${cPct}%` }} />
                <div className="h-full bg-[#FF5F57]/60 flex-1" />
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
});
export const FearGreedWidget = React.memo(() => {
  const { data, loading } = useFearGreed();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(data ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span> : null);
    return () => setHeaderRight(null);
  }, [setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.fearGreed.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-white/20">暂无数据</div>
  );

  const { fearGreed, currentFG, currentFGLabel } = data;
  const vals = fearGreed.map(p => p.value);
  const color = fgColor(currentFG);
  const n = vals.length;

  // ECharts option for the 30D history line — replaces the inline SVG below.
  // Zone bands are drawn via series areaStyle + visualMap-like coloring on the
  // grid (we approximate with horizontal markArea bands).
  const fgOption = {
    grid: { left: 28, right: 8, top: 6, bottom: 22, containLabel: false },
    xAxis: {
      type: 'category',
      data: vals.map((_, i) => i === n - 1 ? '今天' : i === 0 ? '-30天' : i === Math.floor(n / 2) ? '-15天' : ''),
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, interval: 0 },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      min: 0, max: 100,
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ axisValue: string; value: number; dataIndex: number }>) => {
        const v = params[0].value;
        const z = FG_ZONES.find(z => v >= z.min && v <= z.max);
        const head = `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue || `T-${n - 1 - params[0].dataIndex}D`}</div>`;
        return head + `<span style="color:${z?.color ?? color}">●</span> Fear & Greed: <b>${v}</b> ${z ? `<span style="color:${z.color}">${z.label}</span>` : ''}`;
      },
    },
    series: [{
      type: 'line', smooth: 0.25, showSymbol: false,
      lineStyle: { color, width: 1.6 },
      areaStyle: { color: `${color}22` },
      data: vals,
      // Zone bands as background colour
      markArea: {
        silent: true,
        itemStyle: { opacity: 0.06 },
        data: FG_ZONES.map(z => [
          { yAxis: z.min, itemStyle: { color: z.color } },
          { yAxis: z.max },
        ]),
      },
    }],
  };

  // Gauge — ECharts 半圆仪表，axisLine color stops 对应 5 个 FG 区间。
  const gaugeOption = {
    grid: undefined,
    tooltip: { show: false },
    series: [{
      type: 'gauge' as const,
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 100,
      radius: '95%',
      center: ['50%', '78%'],
      progress: { show: false },
      axisLine: {
        lineStyle: {
          width: 8,
          color: FG_ZONES.map(z => [z.max / 100, z.color]) as Array<[number, string]>,
        },
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { width: 2.5, length: '70%', itemStyle: { color } },
      anchor: { show: true, size: 7, itemStyle: { color } },
      title: {
        show: true,
        offsetCenter: [0, '32%'],
        color: 'rgba(255,255,255,0.35)',
        fontSize: 8,
        fontWeight: 400,
      },
      detail: {
        show: true,
        offsetCenter: [0, '12%'],
        color,
        fontSize: 14,
        fontWeight: 700,
        formatter: '{value}',
      },
      data: [{ value: currentFG, name: currentFGLabel }],
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-stretch gap-2 px-3 pt-2 pb-1 shrink-0">
        {/* Gauge */}
        <div className="shrink-0" style={{ width: 114, height: 68 }}>
          <EChart option={gaugeOption} />
        </div>

        {/* Zone legend */}
        <div className="flex flex-col justify-center gap-0.5 flex-1">
          {FG_ZONES.slice().reverse().map(z => (
            <div key={z.label} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: z.color }} />
              <span className="text-[9px] text-white/45">{z.label}</span>
              <span className="text-[9px] text-white/15 ml-auto">{z.min}–{z.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 30D history chart — ECharts line with zone bands */}
      <div className="flex-1 min-h-0 px-2 pb-1">
        <EChart option={fgOption} />
      </div>

      <div className="px-3 pb-2 text-[9px] text-white/15 shrink-0">
        数据来源：alternative.me · 30天历史
      </div>
    </div>
  );
});
export const LargeTradeAlertWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [threshold, setThreshold] = useState(500_000);    // $500k notional
  const [filter, setFilter] = useState<'ALL' | 'C' | 'P'>('ALL');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
        <select
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          className="text-[9px] bg-transparent border border-white/10 rounded px-1 text-slate-400">
          {[100_000, 250_000, 500_000, 1_000_000, 2_000_000].map(v => (
            <option key={v} value={v}>${(v / 1e6).toFixed(v < 1e6 ? 1 : 0)}M+</option>
          ))}
        </select>
        {(['ALL', 'C', 'P'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-1.5 py-0.5 rounded text-[9px] transition-colors"
            style={{
              background: filter === f ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: f === 'C' ? 'var(--nexus-green)' : f === 'P' ? 'var(--nexus-red)' : '#94a3b8',
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

  // Virtual scrolling
  const ltScrollRef = useRef<HTMLDivElement>(null);
  const LT_ROW_H = 28;
  const ltVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => ltScrollRef.current,
    estimateSize: () => LT_ROW_H,
    overscan: 10,
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0">
        <span className="text-[9px] text-slate-600">{visible.length} 条记录（会话内）</span>
      </div>
      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          等待大单…
        </div>
      ) : (
        <>
          {/* Header row (outside scroll) */}
          <div className="grid text-[8px] text-slate-600 uppercase tracking-wider pb-1 px-3 shrink-0 border-b border-white/6"
            style={{ gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px' }}>
            <span>时间</span><span>到期</span><span className="text-right">行权价</span>
            <span>类型</span><span>方向</span><span className="text-right">IV</span>
            <span className="text-right">权利金</span><span className="text-right">名义</span>
          </div>
          <div ref={ltScrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div style={{ height: ltVirtualizer.getTotalSize(), position: 'relative' }}>
              {ltVirtualizer.getVirtualItems().map(virtualRow => {
                const t = visible[virtualRow.index];
                const dirColor = t.direction === 'buy' ? 'var(--nexus-green)' : 'var(--nexus-red)';
                const typeColor = t.optType === 'C' ? 'var(--nexus-green)' : 'var(--nexus-red)';
                const time = new Date(t.ts).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return (
                  <div key={t.id}
                    className="grid items-center px-3 border-b border-white/4 hover:bg-white/2"
                    style={{
                      gridTemplateColumns: '50px 72px 60px 36px 36px 40px 70px 70px',
                      position: 'absolute', top: 0, left: 0, width: '100%',
                      height: LT_ROW_H, transform: `translateY(${virtualRow.start}px)`,
                    }}>
                    <span className="text-[9px] font-mono text-slate-500">{time}</span>
                    <span className="text-[9px] font-mono text-slate-400">{t.expiry}</span>
                    <span className="text-[9px] font-mono text-slate-200 text-right">{t.strike.toLocaleString()}</span>
                    <span className="text-[9px] font-bold text-center" style={{ color: typeColor }}>{t.optType}</span>
                    <span className="text-[9px] font-bold text-center" style={{ color: dirColor }}>
                      {t.direction === 'buy' ? '买' : '卖'}
                    </span>
                    <span className="text-[9px] font-mono text-right text-slate-300">{t.iv.toFixed(1)}%</span>
                    <span className="text-[9px] font-mono text-right" style={{ color: dirColor }}>
                      ${(t.premiumUSD / 1e3).toFixed(0)}K
                    </span>
                    <span className="text-[9px] font-mono text-right text-slate-400">
                      ${(t.notionalUSD / 1e6).toFixed(2)}M
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
});
