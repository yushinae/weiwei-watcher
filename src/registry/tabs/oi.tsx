import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
export const OIByStrikeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  // 'all' = aggregate all expiries; or a specific expiry label
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 8) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  const totalCallOI = callArr.reduce((s, o) => s + o.oi, 0);
  const totalPutOI  = putArr.reduce((s, o) => s + o.oi, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const fmtOI = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);
  const fmtPrice = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  // ECharts horizontal tornado: puts plotted as NEGATIVE values on left, calls
  // positive on right. Y is reversed so largest strike sits at top.
  const strikeLabels = strikes.map(k => {
    const isSpot    = Math.abs(k - spot)    < spot * 0.005;
    const isMaxPain = Math.abs(k - maxPain) < spot * 0.005;
    return fmtPrice(k) + (isSpot ? ' ◆' : isMaxPain ? ' ★' : '');
  });
  const putBars  = strikes.map(k => -(putOI.get(k)  ?? 0));
  const callBars = strikes.map(k =>  (callOI.get(k) ?? 0));

  const oiOption = {
    grid: { left: 70, right: 60, top: 6, bottom: 28, containLabel: false },
    legend: {
      data: [
        { name: 'Put OI',  icon: 'roundRect', itemStyle: { color: 'rgba(202,63,100,0.75)' } },
        { name: 'Call OI', icon: 'roundRect', itemStyle: { color: 'rgba(37,232,137,0.75)' } },
      ],
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      bottom: 4,
    },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => fmtOI(Math.abs(v)) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'category',
      data: strikeLabels,
      inverse: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValue: string; value: number; seriesName: string; color: string }>) => {
        const lines = params.map(p => {
          const v = Math.abs(p.value);
          return `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtOI(v)}</b>`;
        });
        return `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>${lines.join('<br/>')}`;
      },
    },
    series: [
      {
        name: 'Put OI',
        type: 'bar' as const,
        stack: 'oi',
        barWidth: '70%',
        itemStyle: { color: 'rgba(202,63,100,0.65)', borderRadius: [2, 0, 0, 2] },
        data: putBars,
      },
      {
        name: 'Call OI',
        type: 'bar' as const,
        stack: 'oi',
        barWidth: '70%',
        itemStyle: { color: 'rgba(37,232,137,0.65)', borderRadius: [0, 2, 2, 0] },
        data: callBars,
      },
    ],
  };

  // Auto-size: each strike row ~22px tall, capped at the parent's height.
  const chartHeight = Math.max(180, Math.min(strikes.length * 22 + 60, 800));

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
              : 'text-white/45 hover:text-white/60 hover:bg-white/[0.04]',
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
                : 'text-white/45 hover:text-white/60 hover:bg-white/[0.04]',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 px-3 pb-2 text-[10px] shrink-0">
        <span className="text-white/45">Call OI <span className="font-mono text-emerald-400/80">{fmtOI(totalCallOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/45">Put OI <span className="font-mono text-rose-400/80">{fmtOI(totalPutOI)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/45">PCR <span className="font-mono text-amber-400/80">{pcr.toFixed(2)}</span></span>
        <span className="text-white/20">·</span>
        <span className="text-white/45">最大痛点 <span className="font-mono text-[var(--nexus-accent)]/80">{maxPain.toLocaleString()}</span></span>
      </div>

      {/* Chart — ECharts tornado bars (put left, call right) */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-1">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/20">暂无持仓数据</div>
          : <div style={{ height: chartHeight, width: '100%' }}><EChart option={oiOption} /></div>
        }
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        ◆ 现货价  ★ 最大痛点  数据来源：Deribit · {expFilter === 'all' ? '全部到期日' : expFilter}
      </div>
    </div>
  );
});
export const GEXWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [expFilter, setExpFilter] = useState<'all' | string>('all');

  const expiries = data?.expiries.slice(0, 6) ?? [];

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  // ECharts horizontal tornado: positive GEX (call dominance) right, negative left.
  // Same pattern as OI by Strike — but coloured by sign of net GEX.
  const strikeLabels = strikes.map(k => {
    const isSpot = Math.abs(k - spot) / spot < 0.005;
    const isZero = zeroGamma !== null && Math.abs(k - zeroGamma) / spot < 0.005;
    return fmtPx(k) + (isSpot ? ' ◆' : isZero ? ' ○' : '');
  });

  // Splitting positive vs negative into two stacked series gives us per-side colours.
  // Bars on the same strike share a y-axis category, so it still reads as a single bar.
  const posBars = netGex.map(v => (v > 0 ? +v.toFixed(0) : 0));
  const negBars = netGex.map(v => (v < 0 ? +v.toFixed(0) : 0));

  const chartHeight = Math.max(220, Math.min(strikes.length * 22 + 60, 800));

  const gexOption = {
    grid: { left: 78, right: 60, top: 6, bottom: 8, containLabel: false },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => fmtGex(v) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'category',
      data: strikeLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValue: string; value: number; seriesName: string; color: string; dataIndex: number }>) => {
        const idx = params[0].dataIndex;
        const net = netGex[idx];
        const col = net >= 0 ? '#25e889' : '#FF5F57';
        return `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>` +
               `<span style="color:${col}">●</span> 净 GEX: <b>${fmtGex(net)}</b>`;
      },
    },
    series: [
      {
        name: 'GEX-',
        type: 'bar' as const,
        stack: 'gex',
        barWidth: '70%',
        itemStyle: { color: 'rgba(248,113,113,0.7)', borderRadius: [2, 0, 0, 2] },
        data: negBars,
      },
      {
        name: 'GEX+',
        type: 'bar' as const,
        stack: 'gex',
        barWidth: '70%',
        itemStyle: { color: 'rgba(37,232,137,0.7)', borderRadius: [0, 2, 2, 0] },
        data: posBars,
      },
    ],
  };

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
          { label: '净 GEX', val: fmtGex(totalNet), color: totalNet >= 0 ? '#25e889' : '#FF5F57' },
          { label: '零 Gamma', val: zeroGamma ? fmtPx(zeroGamma) : '—', color: '#FEBC2E' },
          { label: '现货', val: fmtPx(spot), color: 'rgba(255,255,255,0.6)' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">{s.label}</div>
            <div className="font-mono text-[12px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* GEX chart — ECharts tornado, +/- color-coded */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-1">
        {strikes.length === 0
          ? <div className="py-8 text-center text-[11px] text-white/20">暂无 Gamma 敞口</div>
          : <div style={{ height: chartHeight, width: '100%' }}><EChart option={gexOption} /></div>
        }
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        ◆ 现货  ○ 零Gamma  GEX = Γ × OI × S² / 100（每1%标的波动）· Deribit
      </div>
    </div>
  );
});
export const ExpiryCalendarWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data || !data.expiries.length || !calRows) return <div className="p-3 text-[11px] text-white/20">暂无到期日数据</div>;

  const rows = calRows;
  const spot = data.spot;
  const maxOI = Math.max(...rows.map(r => r.totalOI), 1);
  const fmtK  = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0);
  const fmtPx = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  const BAR_MAX = 220; // max bar width in px
  const ROW_H = 38;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Column headers */}
      <div className="grid grid-cols-[52px_1fr_60px_56px_60px_70px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期日', 'OI 分布（Call ▶ ◀ Put）', 'PCR', 'ATM IV', 'Max Pain', '偏离现货'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
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
                isNear && 'bg-amber-500/[0.04]',
              )}
              style={{ minHeight: ROW_H }}
            >
              {/* Label */}
              <div>
                <div className={cn('text-[11px] font-mono font-bold', isNear ? 'text-amber-400' : 'text-white/60')}>{r.label}</div>
                <div className="text-[9px] text-white/20">{r.daysToExp}天</div>
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
              <span className="font-mono text-[11px] text-white/45">
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
        <span className="text-[9px] text-white/15">
          Max Pain = 期权卖方总损失最小的到期价
        </span>
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(37,232,137,0.55)]" />
            <span className="text-[9px] text-white/25">Call OI</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-[2px] bg-[rgba(248,113,113,0.55)]" />
            <span className="text-[9px] text-white/25">Put OI</span>
          </div>
        </div>
      </div>
    </div>
  );
});
export const DEXWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!sorted.length) return <div className="p-4 text-[11px] text-white/20">数据不足</div>;

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

  // ECharts tornado: split positive (resistance, red) and negative (support, green)
  // into two stacked series so each side gets its own colour.
  const strikeLabels = sorted.map(([strike]) => {
    const isSpot = Math.abs(strike - spot) / spot < (BIN / spot) * 0.6;
    return fmtK2(strike) + (isSpot ? ' ◆' : '');
  });
  const dexValues = sorted.map(([, v]) => +v.toFixed(3));
  const posBars = dexValues.map(v => (v > 0 ? v : 0));
  const negBars = dexValues.map(v => (v < 0 ? v : 0));
  const chartHeight = Math.max(220, Math.min(sorted.length * 22 + 60, 800));

  const dexOption = {
    grid: { left: 70, right: 60, top: 6, bottom: 8, containLabel: false },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => fmtM(v) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'category',
      data: strikeLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.55)',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ axisValue: string; value: number; seriesName: string; color: string; dataIndex: number }>) => {
        const idx = params[0].dataIndex;
        const v = dexValues[idx];
        const col = v >= 0 ? '#FF5F57' : '#25e889';
        const label = v >= 0 ? '净多 δ（阻力）' : '净空 δ（支撑）';
        return `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>` +
               `<span style="color:${col}">●</span> ${label}: <b>${v >= 0 ? '+' : ''}${fmtM(v)}</b>`;
      },
    },
    series: [
      {
        name: 'support', type: 'bar' as const, stack: 'dex', barWidth: '70%',
        itemStyle: { color: 'rgba(37,232,137,0.7)', borderRadius: [2, 0, 0, 2] },
        data: negBars,
      },
      {
        name: 'resistance', type: 'bar' as const, stack: 'dex', barWidth: '70%',
        itemStyle: { color: 'rgba(248,113,113,0.7)', borderRadius: [0, 2, 2, 0] },
        data: posBars,
      },
    ],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Summary */}
      <div className="flex gap-2 px-3 pt-2 pb-1.5 shrink-0">
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">净 DEX</div>
          <div className="font-mono text-[13px] font-bold" style={{ color: netColor }}>
            {netDEX >= 0 ? '+' : ''}{fmtM(netDEX)}
          </div>
        </div>
        <div className="flex-1 bg-white/[0.025] border border-white/[0.06] rounded-[8px] px-2 py-1.5">
          <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5">方向</div>
          <div className="font-mono text-[12px] font-bold" style={{ color: netColor }}>
            {netDEX < 0 ? '做市商净空 → 助涨' : '做市商净多 → 阻涨'}
          </div>
        </div>
      </div>

      {/* Horizontal bar chart — ECharts tornado */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-1">
        <div style={{ height: chartHeight, width: '100%' }}>
          <EChart option={dexOption} />
        </div>
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        绿=做市商净空δ（买盘支撑） 红=净多δ（卖压阻力） 单位$M · Deribit
      </div>
    </div>
  );
});
export const KeyLevelsWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

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
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] truncate">{lv.label}</div>
            <div className="font-mono text-[14px] font-bold leading-tight" style={{ color: lv.color }}>
              ${fmtPx2(lv.price)}
            </div>
            <div className="flex items-end justify-between gap-1">
              <span className="text-[8.5px] text-white/20 leading-snug truncate">{lv.desc}</span>
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
});
export const TopOIWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
                sortBy === m ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {m === 'oi' ? '持仓量' : '成交量'}
            </button>
          ))}
        </div>
        {data && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

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
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
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
              <span className="text-[10px] text-white/20 font-mono">{i + 1}</span>
              <div>
                <span className="font-mono text-[11px] font-bold text-white/75">${fmtK(o.strike)}</span>
                <div className="text-[8.5px] mt-0.5" style={{ color: m.color }}>{m.label}</div>
              </div>
              <span className="font-mono text-[10px] text-white/45">{o.expLabel}</span>
              <span className="font-mono text-[11px] font-bold" style={{ color: typeColor }}>
                {o.type === 'C' ? 'CALL' : 'PUT'}
              </span>
              <span className="font-mono text-[10px] text-white/50">{o.iv.toFixed(1)}%</span>
              <span className="font-mono text-[10px] text-white/45">{o.delta.toFixed(2)}</span>

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

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        按{sortBy === 'oi' ? '持仓量' : '成交量'}排序 · 全到期日 · Deribit
      </div>
    </div>
  );
});
export const GammaPinWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

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
      <span className="text-[13px] text-slate-600">✓</span>
      <span className="text-[11px] text-slate-500">7日内无 Gamma 钉牢候选（无近期高OI集中）</span>
    </div>
  );

  const maxScore = top[0].pinScore;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
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
              <span className="text-[9px] text-slate-600 w-3 shrink-0">#{i + 1}</span>
              <span className="text-[10px] font-mono font-bold text-slate-200 w-[72px] shrink-0">
                {c.strike.toLocaleString()}
              </span>
              <span className="text-[9px] font-mono text-slate-500 w-[52px] shrink-0">{c.expiry}</span>
              <span className="text-[9px] font-mono w-[36px] shrink-0" style={{ color: distColor }}>{distLabel}</span>
              <span className="text-[9px] font-mono text-slate-500 w-[28px] shrink-0">{c.daysToExp}d</span>
              <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-white/4">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: 'var(--nexus-accent)', opacity: 0.7 }} />
              </div>
              <span className="text-[9px] font-mono text-slate-500 w-[56px] shrink-0 text-right">
                OI {c.totalOI.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
