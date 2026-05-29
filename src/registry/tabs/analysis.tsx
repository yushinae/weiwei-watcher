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
export const BTCETHSpreadWidget = React.memo(() => {
  const { btc, eth, timedOut } = useDualHistory();
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(btc && eth
      ? <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>
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

  // X 轴：90 天序列 (T-89 … T-0)
  const xLabels = btcA.map((_, i) => i === btcA.length - 1 ? '今' : i === 0 ? '-90D' : '');
  const xInterval = Math.max(0, Math.floor(btcA.length / 6));

  // DVOL 双线叠加：BTC 黄 / ETH 蓝
  const dvolOption = {
    grid: { left: 32, right: 8, top: 22, bottom: 18, containLabel: false },
    legend: {
      show: true,
      top: 0,
      right: 4,
      itemWidth: 8,
      itemHeight: 2,
      textStyle: { color: 'rgba(255,255,255,0.4)', fontSize: 9 },
      data: ['BTC', 'ETH'],
    },
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8, interval: xInterval },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8, formatter: (v: number) => `${v.toFixed(0)}` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number | string) => typeof v === 'number' ? `${v.toFixed(1)}%` : String(v),
    },
    series: [
      {
        name: 'BTC', type: 'line' as const, smooth: 0.2, showSymbol: false,
        lineStyle: { color: '#FEBC2E', width: 1.4 },
        areaStyle: { color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(245,158,11,0.22)' }, { offset: 1, color: 'rgba(245,158,11,0.02)' }],
        } },
        data: btcA.map(v => +v.toFixed(2)),
      },
      {
        name: 'ETH', type: 'line' as const, smooth: 0.2, showSymbol: false,
        lineStyle: { color: '#4ea1ff', width: 1.2, opacity: 0.85 },
        areaStyle: { color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(78,161,255,0.18)' }, { offset: 1, color: 'rgba(78,161,255,0.02)' }],
        } },
        data: ethA.map(v => +v.toFixed(2)),
      },
    ],
  };

  // 价差图：单线 + 零线 markLine + 百分位标注
  const spreadOption = {
    grid: { left: 36, right: 36, top: 18, bottom: 18, containLabel: false },
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8, interval: xInterval },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8,
        formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number | string) =>
        typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp` : String(v),
    },
    series: [{
      name: 'BTC−ETH', type: 'line' as const, smooth: 0.2, showSymbol: false,
      lineStyle: { color: spreadColor, width: 1.5, opacity: 0.95 },
      areaStyle: { color: `${spreadColor}1A` },
      data: spread.map(v => +v.toFixed(2)),
      markLine: {
        symbol: 'none', silent: true,
        lineStyle: { color: 'rgba(255,255,255,0.16)', type: 'dashed', width: 0.8 },
        data: [{ yAxis: 0 }],
      },
    }],
    graphic: [{
      type: 'text', right: 6, top: 4,
      style: { text: `${pctile.toFixed(0)}%ile`, fill: 'rgba(255,255,255,0.25)', fontSize: 9 },
    }],
  };

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
            <div className="text-[9px] text-white/25 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold truncate" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Dual chart — two panels stacked */}
      <div className="flex flex-1 min-h-0 gap-2 px-3 pb-2">
        {/* DVOL overlay */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="text-[8.5px] text-white/20 mb-0.5 uppercase tracking-wider shrink-0">DVOL 历史（90D）</div>
          <div className="flex-1 min-h-0"><EChart option={dvolOption} /></div>
        </div>

        {/* Spread chart */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="text-[8.5px] text-white/20 mb-0.5 uppercase tracking-wider shrink-0">价差（BTC − ETH，pp）</div>
          <div className="flex-1 min-h-0"><EChart option={spreadOption} /></div>
        </div>
      </div>
    </div>
  );
});
export const VolRegimeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }      = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }               = useDeribitOptions(coin);
  const { data: hist }         = useDeribitHistory(coin);
  const { data: flow }         = useFlowData(coin);
  const { setHeaderRight }     = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (!data) return <Skeleton />;

  const result = classifyRegime(data, hist, flow);

  // ECharts 半圆仪表：progress 显示 confidence 比例 + result.color
  const regimeGaugeOption = {
    grid: undefined,
    tooltip: { show: false },
    series: [{
      type: 'gauge' as const,
      startAngle: 180, endAngle: 0,
      min: 0, max: 100,
      radius: '92%',
      center: ['50%', '78%'],
      progress: {
        show: true,
        width: 4,
        roundCap: true,
        itemStyle: { color: result.color, shadowBlur: 6, shadowColor: `${result.color}88` },
      },
      axisLine: { lineStyle: { width: 4, color: [[1, 'rgba(255,255,255,0.08)']] as Array<[number, string]> } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      anchor: { show: false },
      title: {
        show: true,
        offsetCenter: [0, '34%'],
        color: 'rgba(255,255,255,0.25)',
        fontSize: 7,
        fontWeight: 400,
      },
      detail: {
        show: true,
        offsetCenter: [0, '8%'],
        color: result.color,
        fontSize: 11,
        fontWeight: 700,
        formatter: '{value}%',
      },
      data: [{ value: result.confidence, name: '置信度' }],
    }],
  };

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
          <div style={{ width: 96, height: 56 }}>
            <EChart option={regimeGaugeOption} />
          </div>
          <div className="text-[10px] font-bold text-center leading-tight mt-0.5" style={{ color: result.color }}>
            {result.label}
          </div>
        </div>

        {/* Description + factors */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="text-[10px] text-white/45 leading-relaxed">{result.description}</p>

          {/* Factor pills */}
          <div className="flex gap-1.5 flex-wrap">
            {factors.map(f => (
              <div key={f.label}
                className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 border"
                style={{
                  borderColor: f.ok ? 'rgba(37,232,137,0.2)' : 'rgba(248,113,113,0.2)',
                  background:  f.ok ? 'rgba(37,232,137,0.05)' : 'rgba(248,113,113,0.05)',
                }}>
                <span className="text-[8.5px] text-white/45">{f.label}</span>
                <span className="font-mono text-[9px] font-bold"
                  style={{ color: f.ok ? '#25e889' : '#FF5F57' }}>{f.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Playbook */}
        <div className="shrink-0 flex flex-col gap-1" style={{ width: 240 }}>
          <div className="text-[9px] font-bold text-white/25 uppercase tracking-wider mb-0.5">策略建议</div>
          {result.playbook.map((tip, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold mt-0.5"
                style={{ background: `${result.color}20`, color: result.color }}>
                {i + 1}
              </span>
              <span className="text-[9px] text-white/50 leading-snug">{tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
export const PriceTargetProbWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
    // ExpiryGroup 提供 daysToExp（天），d2() 需要 T（年）。
    const probGrid: number[][] = strikes.map(k =>
      exps.map(e => normCDF(d2(spot, k, e.daysToExp / 365, getStrikeIV(e, k))) * 100)
    );
    return { spot, exps, strikes, probGrid };
  }, [data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.expiries.length || !computed) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const { spot, exps, strikes, probGrid } = computed;

  const fmtK = (v: number) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0);

  // strikes 数组：index 0 = 最小行权价 (-20%)，最后 = 最大 (+20%)。
  // 原 SVG 把 index 0 放在顶部，所以 yAxis 用 inverse: true 还原顺序。
  // yAxis.data 需要与 heatmap data[1] 字符串严格相等，故用稳定 key + axisLabel.formatter 渲染富文本。
  const yKeyToLabel: Record<string, string> = {};
  strikes.forEach((k, idx) => {
    const isAtm = Math.abs(k - spot) / spot < 0.025;
    const off = ((k - spot) / spot) * 100;
    const tag = isAtm ? 'atm' : 'norm';
    yKeyToLabel[`__row_${idx}`] = `{${tag}|$${fmtK(k)}}\n{${tag}o|${off >= 0 ? '+' : ''}${off.toFixed(0)}%}`;
  });
  const yKeys = strikes.map((_, idx) => `__row_${idx}`);

  // 单元格背景色（与原 SVG 实现保持一致：red→amber→green 平滑过渡）
  const cellBg = (p: number) => {
    if (p >= 80) return `rgba(37,232,137,${(0.15 + (p - 80) / 20 * 0.5).toFixed(3)})`;
    if (p >= 50) return `rgba(245,158,11,${(0.10 + (p - 50) / 30 * 0.35).toFixed(3)})`;
    return `rgba(248,113,113,${(0.10 + (50 - p) / 50 * 0.55).toFixed(3)})`;
  };

  const xCats = exps.map(e => e.label);
  const heatData: Array<[string, string, number]> = [];
  for (let i = 0; i < strikes.length; i++) {
    for (let j = 0; j < exps.length; j++) {
      const raw = probGrid[i][j];
      const v = Number.isFinite(raw) ? +raw.toFixed(1) : 0;
      heatData.push([xCats[j], yKeys[i], v]);
    }
  }

  const probOption = {
    grid: { left: 72, right: 12, top: 24, bottom: 8, containLabel: false },
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: { data: [string, string, number] }) => {
        const [xCat, yCat, v] = p.data;
        const i = +yCat.replace('__row_', '');
        return `<b>${xCat}</b> · $${fmtK(strikes[i])}<br/>P(收盘&gt;K) = <b>${v.toFixed(1)}%</b>`;
      },
    },
    xAxis: {
      type: 'category',
      data: xCats,
      position: 'top' as const,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: 600 },
    },
    yAxis: {
      type: 'category',
      data: yKeys,
      inverse: true,
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 9, lineHeight: 11, align: 'right' as const,
        formatter: (k: string) => yKeyToLabel[k] ?? k,
        rich: {
          norm: { color: 'rgba(255,255,255,0.45)', fontSize: 9 },
          normo: { color: 'rgba(255,255,255,0.18)', fontSize: 7 },
          atm: { color: '#FEBC2E', fontSize: 9, fontWeight: 'bold' as const },
          atmo: { color: 'rgba(245,158,11,0.55)', fontSize: 7 },
        },
      },
    },
    visualMap: {
      show: false,
      min: 0, max: 100,
      seriesIndex: 0,
      dimension: 2,
      inRange: {
        color: ['rgba(248,113,113,0.7)', 'rgba(248,113,113,0.25)', 'rgba(245,158,11,0.30)', 'rgba(245,158,11,0.55)', 'rgba(37,232,137,0.30)', 'rgba(37,232,137,0.70)'],
      },
    },
    series: [{
      type: 'heatmap' as const,
      data: heatData,
      label: {
        show: true,
        fontSize: 9,
        fontWeight: 600,
        formatter: (p: { data: [string, string, number] }) => {
          const v = p.data[2];
          const c = v >= 70 ? 'g' : v >= 45 ? 'y' : 'r';
          return `{${c}|${v.toFixed(0)}%}`;
        },
        rich: {
          g: { color: '#25e889', fontSize: 9, fontWeight: 'bold' as const },
          y: { color: '#FEBC2E', fontSize: 9, fontWeight: 'bold' as const },
          r: { color: '#FF5F57', fontSize: 9, fontWeight: 'bold' as const },
        },
      },
      itemStyle: {
        borderColor: 'rgba(0,0,0,0.25)',
        borderWidth: 1,
        borderRadius: 3,
      },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(255,255,255,0.2)' } },
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1.5 pb-1 text-[9px] text-white/25 shrink-0">
        P(收盘 &gt; 行权价) = N(d₂)·100%，基于当前 ATM IV · 风险中性概率，非真实概率
      </div>
      <div className="flex-1 min-h-0 px-2 pb-2">
        <EChart option={probOption} />
      </div>
    </div>
  );
});
export const EWMAForecastWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin }   = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: hist, timedOut }  = useDeribitHistory(coin);
  const { data: optData }         = useDeribitOptions(coin);
  const { setHeaderRight }  = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {hist && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  // ECharts 时间轴：把历史 -29..0 和预测 0..60 合并到一条 category 轴上。
  // 历史末端 (T=0) 与预测起点 (T+0) 共享同一根 x 刻度，做平滑衔接。
  const histLen = histSlice.length;          // ≤ 30
  const fcstLen = forecastPath.length;       // 61
  const totalLen = histLen + fcstLen - 1;    // 共享 1 个点
  const xLabels: string[] = [];
  for (let i = 0; i < histLen; i++) xLabels.push(`T${-(histLen - 1 - i)}`);
  for (let i = 1; i < fcstLen; i++) xLabels.push(`T+${i}`);

  // 历史 series 数据：左半段填值，右半段填 null
  const histData = xLabels.map((_, i) => i < histLen ? +histSlice[i].toFixed(2) : null);
  // 预测 series 数据：右半段填值，左半段填 null；让历史末端 = 预测起点 自然衔接
  const fcstData = xLabels.map((_, i) => {
    if (i < histLen - 1) return null;
    return +forecastPath[i - (histLen - 1)].toFixed(2);
  });

  // ±1σ 置信带 (基于历史日变化标准差 × √t × 0.8 系数，与原 SVG 实现一致)
  const sigmaSum = hist.dvolSeries.reduce((s, v, i, arr) =>
    i === 0 ? 0 : s + Math.pow(v - arr[i - 1], 2), 0);
  const dailyStd = Math.sqrt(sigmaSum / Math.max(hist.dvolSeries.length - 1, 1));
  const lowerBand: Array<number | null> = xLabels.map((_, i) => {
    if (i < histLen - 1) return null;
    const k = i - (histLen - 1);
    const band = dailyStd * Math.sqrt(k + 1) * 0.8;
    return +(forecastPath[k] - band).toFixed(2);
  });
  const bandRange: Array<number | null> = xLabels.map((_, i) => {
    if (i < histLen - 1) return null;
    const k = i - (histLen - 1);
    const band = dailyStd * Math.sqrt(k + 1) * 0.8;
    return +(2 * band).toFixed(2);
  });

  const xJoinIdx = histLen - 1;

  const fcstOption = {
    grid: { left: 36, right: 12, top: 16, bottom: 22, containLabel: false },
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.3)', fontSize: 8,
        interval: (idx: number, val: string) =>
          val === `T${-(histLen - 1)}` || val === 'T+0' || val === 'T+30' || val === `T+${fcstLen - 1}`,
        formatter: (val: string) => val === 'T+0' ? '今' : val === `T${-(histLen - 1)}` ? '-30D' : val === `T+${fcstLen - 1}` ? '+60D' : val,
      },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8, formatter: (v: number) => `${v.toFixed(0)}` },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number | string) =>
        typeof v === 'number' ? `${v.toFixed(1)}%` : '—',
    },
    series: [
      // 历史
      {
        name: '历史', type: 'line' as const, smooth: 0.2, showSymbol: false,
        lineStyle: { color: BRAND, width: 1.4, opacity: 0.9 },
        areaStyle: { color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(37,232,137,0.22)' }, { offset: 1, color: 'rgba(37,232,137,0.02)' }],
        } },
        data: histData,
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed', width: 0.8 },
          label: { formatter: `μ=${mu.toFixed(0)}`, color: 'rgba(255,255,255,0.35)', fontSize: 8, position: 'end' as const },
          data: [{ yAxis: +mu.toFixed(2) }],
        },
      },
      // 置信带下沿（不可见线，仅作为 stack 基线）
      {
        name: '__band_lower', type: 'line' as const, stack: 'band', symbol: 'none',
        lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 },
        tooltip: { show: false }, silent: true,
        data: lowerBand,
      },
      // 置信带范围
      {
        name: '±1σ', type: 'line' as const, stack: 'band', symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: 'rgba(167,139,250,0.12)' },
        tooltip: { show: false }, silent: true,
        data: bandRange,
      },
      // 预测路径（虚线）
      {
        name: '预测', type: 'line' as const, smooth: 0.25, showSymbol: false,
        lineStyle: { color: '#a78bfa', width: 1.2, type: 'dashed' as const, opacity: 0.9 },
        data: fcstData,
        markPoint: {
          symbol: 'circle', symbolSize: 6,
          itemStyle: { color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)', borderWidth: 2 },
          label: { show: false },
          data: [{ xAxis: xJoinIdx, yAxis: +current.toFixed(2) }],
        },
      },
    ],
  };

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
            <div className="text-[9px] text-white/20 uppercase tracking-[0.06em] mb-0.5 truncate">{s.label}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0 gap-3 px-3 pb-2">
        {/* Chart */}
        <div className="flex-1 min-w-0">
          <EChart option={fcstOption} />
        </div>

        {/* Forecast table */}
        <div className="shrink-0 flex flex-col gap-1.5" style={{ width: 170 }}>
          <div className="text-[9px] font-bold text-white/20 uppercase tracking-wider mb-0.5">预测 vs 市场 IV</div>
          {forecasts.map(f => {
            const diff = f.forecast - f.marketIV;
            const col = fmtColor(f.forecast, f.marketIV);
            const signal = diff < -3 ? '↓ IV 偏贵' : diff > 3 ? '↑ IV 偏便宜' : '≈ 合理';
            return (
              <div key={f.horizon}
                className="rounded-[7px] border px-2.5 py-1.5"
                style={{ borderColor: `${col}25`, background: `${col}08` }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] text-white/45">+{f.horizon}D 预测</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: col }}>{signal}</span>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <div className="text-[8px] text-white/20 mb-0">AR(1)</div>
                    <div className="font-mono text-[11px] font-bold" style={{ color: col }}>{f.forecast.toFixed(1)}%</div>
                  </div>
                  <div className="text-white/20 text-[8px] mb-0.5">vs</div>
                  <div>
                    <div className="text-[8px] text-white/20 mb-0">市场 IV</div>
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
});
export const GreeksScenarioWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expIdx, setExpIdx] = useState(0);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
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
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>
  );

  const expiries = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0).slice(0, 6);
  if (!expiries.length) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>
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
              color: i === safeIdx ? 'var(--nexus-accent)' : '#64748b',
              border: `1px solid ${i === safeIdx ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
            }}>
            {e.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-slate-600 font-mono">
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
              <th className="text-left text-[9px] text-slate-600 pb-1 pr-2 font-normal">Spot↓/IV→</th>
              {SCEN_IV.map(ds => (
                <th key={ds} className="text-center text-[9px] font-mono pb-1 px-0.5"
                  style={{ color: ds < 0 ? 'var(--nexus-red)' : ds > 0 ? 'var(--nexus-green)' : '#94a3b8' }}>
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
                    color: sp < 0 ? 'var(--nexus-red)' : sp > 0 ? 'var(--nexus-green)' : '#94a3b8',
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
                        color: Math.abs(v) > maxAbs * 0.25 ? '#fff' : '#64748b',
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
});
export const CorrelationWidget = React.memo(() => {
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

  if (loading) return timedOut ? <HistLoadErr /> : <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const corrColor = (v: number) => v > 0.7 ? '#6366F1' : v > 0.4 ? '#FEBC2E' : v > 0 ? '#64748b' : '#FF5F57';
  const cur = current ?? 0;
  const regime = cur > 0.8 ? '高度同步' : cur > 0.6 ? '较强同步' : cur > 0.4 ? '中等相关' : cur > 0.2 ? '弱相关' : '背离走势';
  const curColor = corrColor(cur);

  const xLabels = corrSeries.map((_, i) =>
    i === 0 ? '← 90天前' : i === corrSeries.length - 1 ? '今日 →' : '');
  const xInterval = Math.max(0, Math.floor(corrSeries.length / 6));

  const corrOption = {
    grid: { left: 30, right: 12, top: 8, bottom: 20, containLabel: false },
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 9, interval: xInterval },
    },
    yAxis: {
      type: 'value', min: -1, max: 1,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 8,
        formatter: (v: number) => v.toFixed(1) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number | string) => typeof v === 'number' ? v.toFixed(3) : String(v),
    },
    series: [{
      name: '30D 相关', type: 'line' as const, smooth: 0.2, showSymbol: false,
      lineStyle: { color: curColor, width: 1.8 },
      areaStyle: { color: `${curColor}24` },
      data: corrSeries.map(v => +v.toFixed(4)),
      markLine: {
        symbol: 'none', silent: true,
        lineStyle: { color: 'rgba(255,255,255,0.08)', type: 'dashed' as const, width: 0.8 },
        data: [{ yAxis: 0.8 }, { yAxis: 0.6 }, { yAxis: 0, lineStyle: { color: 'rgba(255,255,255,0.14)', type: 'dashed' as const, width: 1 } }, { yAxis: -0.6 }],
      },
      markPoint: {
        symbol: 'circle', symbolSize: 7,
        itemStyle: { color: curColor, borderColor: 'rgba(0,0,0,0.3)', borderWidth: 1 },
        label: { show: false },
        data: [{ xAxis: corrSeries.length - 1, yAxis: +cur.toFixed(4) }],
      },
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      {/* Header */}
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[10px] text-slate-500">BTC / ETH 已实现相关系数（30日滚动）</span>
        <span className="text-[18px] font-mono font-bold tnum ml-auto" style={{ color: curColor }}>
          {cur.toFixed(3)}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${curColor}20`, color: curColor }}>
          {regime}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <EChart option={corrOption} />
      </div>
    </div>
  );
});
export const IVCheapnessWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [opt, setOpt]     = useState<DeribitData | null>(null);
  const [hist, setHist]   = useState<HistoryData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [timedOut, setTimedOut]   = useState(false);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
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
    : <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

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
    'very-cheap':     { bg: 'rgba(37,167,80,0.25)',   text: '#4ade80', label: '极便宜' },
    'cheap':          { bg: 'rgba(37,167,80,0.12)',   text: '#5DD879', label: '便宜'   },
    'fair':           { bg: 'rgba(255,255,255,0.04)', text: '#94a3b8', label: '合理'   },
    'expensive':      { bg: 'rgba(244,63,94,0.12)',   text: '#FF8C57', label: '偏贵'   },
    'very-expensive': { bg: 'rgba(244,63,94,0.25)',   text: '#FF5F57', label: '极贵'   },
  }[v]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        当前 IV 对比历史 RV 分位锥 — 颜色=便宜/贵评级，VRP=溢价
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
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
              const vrpColor = r.vrp > 3 ? 'var(--nexus-red)' : r.vrp < -3 ? 'var(--nexus-green)' : '#94a3b8';
              return (
                <tr key={r.tenor} className="border-t border-white/4" style={{ background: vs.bg }}>
                  <td className="py-1.5 text-slate-400 font-bold">{r.label}</td>
                  <td className="py-1.5 text-right text-slate-200 font-bold">{r.iv.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-slate-400">{r.rv.toFixed(1)}%</td>
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
});
