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
export const VolSmileWidget = React.memo(({
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
});
export const VRPHistoryWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const vrpData = histData?.vrp ?? VRP_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
});
export const IVRankHistoryWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const ivrData = histData?.ivr ?? IVR_HIST[coin];
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
});
export const VolConeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData } = useDeribitHistory(coin);
  const { data: optData } = useDeribitOptions(coin);
  const mockCone = VOL_CONE[coin];
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
});
export const IVSurfaceWidget = React.memo(({
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
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
});
export const OptionsSkewWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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
});
export const DVOLSeriesWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data: histData, timedOut } = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {histData && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, histData]);

  if (!histData) return timedOut ? <HistLoadErr /> : <Skeleton />;

  const dvol = histData.dvolSeries;
  const rv30 = histData.rv30Series;
  if (!dvol.length) return <Skeleton />;

  const n = dvol.length;
  const rv30Aligned = rv30.length >= n
    ? rv30.slice(-n)
    : [...Array(n - rv30.length).fill(rv30[0] ?? 0), ...rv30];

  const currDvol = dvol[dvol.length - 1];
  const currRv = rv30[rv30.length - 1];
  const vrp = currDvol - currRv;

  // X-axis: "T-89D" → "T-0D" (today). Plain labels keep tooltip readable.
  const xLabels = dvol.map((_, i) => `T-${n - 1 - i}D`);

  const option = {
    legend: {
      data: [
        { name: 'DVOL', icon: 'roundRect', itemStyle: { color: BRAND } },
        { name: 'RV 30D', icon: 'roundRect', itemStyle: { color: BLUE } },
      ],
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      right: 12, top: 0,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, interval: 6 },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    // Wheel zoom only — slider eats too much vertical room in a compact card.
    dataZoom: [{ type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseWheel: false }],
    series: [
      {
        name: 'RV 30D',
        type: 'line',
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { color: BLUE, width: 1.2, type: 'dashed' as const },
        areaStyle: { color: 'rgba(78,161,255,0.10)' },
        data: rv30Aligned.map(v => +v.toFixed(2)),
      },
      {
        name: 'DVOL',
        type: 'line',
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { color: BRAND, width: 1.6 },
        areaStyle: { color: 'rgba(37,232,137,0.10)' },
        data: dvol.map(v => +v.toFixed(2)),
      },
    ],
    tooltip: {
      valueFormatter: (v: number | string) =>
        typeof v === 'number' ? `${v.toFixed(1)}%` : String(v),
    },
    grid: { left: 36, right: 12, top: 24, bottom: 22 },
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Stats — inline single-row, no card chrome to save vertical space */}
      <div className="flex items-center gap-4 px-3 pt-1.5 pb-1 shrink-0 text-[10px]">
        {[
          { label: 'DVOL 当前', val: `${currDvol.toFixed(1)}%`, color: BRAND },
          { label: 'RV30 当前', val: `${currRv.toFixed(1)}%`, color: BLUE },
          { label: 'VRP', val: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}%`, color: vrp >= 0 ? '#25e889' : '#FF5F57' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="text-white/45 uppercase tracking-[0.05em]">{s.label}</span>
            <span className="font-mono text-[12px] font-bold" style={{ color: s.color }}>{s.val}</span>
          </div>
        ))}
        <span className="ml-auto text-[9px] text-white/20">滚轮缩放 · hover 查看数值</span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-1">
        <EChart option={option} />
      </div>
    </div>
  );
});
export const VannaCharmWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [mode, setMode] = useState<'vanna' | 'charm'>('vanna');

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
          {(['vanna', 'charm'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('text-[10px] font-bold px-2 py-0.5 rounded-[18px] transition-colors',
                mode === m ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {m === 'vanna' ? 'Vanna' : 'Charm'}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data, mode]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const expiries = pickExpiries(data.expiries, [7, 14, 30, 60, 90]).slice(0, 5);

  // Collect strikes ±15% of spot (binned to nearest round number)
  const BIN = spot > 10000 ? 1000 : 100;
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

  // ECharts heatmap data: [colIdx, rowIdx, value]. rowIdx is inverted so the
  // highest strike appears at the top (matches the old SVG layout).
  const yLabels = strikes.map(k => {
    const isSpot = Math.abs(k - spot) / spot < 0.006;
    return fmtK(k) + (isSpot ? ' ◆' : '');
  });
  const xLabels = expiries.map(e => e.label);
  const heatData: [number, number, number][] = [];
  for (let i = 0; i < strikes.length; i++) {
    for (let j = 0; j < expiries.length; j++) {
      heatData.push([j, i, grid[i][j]]);
    }
  }

  const heatOption = {
    grid: { left: 70, right: 20, top: 28, bottom: 8, containLabel: false },
    xAxis: {
      type: 'category',
      data: xLabels,
      position: 'top' as const,
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.45)',
        fontSize: 10,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    },
    // Diverging red ↔ neutral ↔ green centred on 0
    visualMap: {
      min: -maxAbs,
      max: maxAbs,
      show: false,
      inRange: {
        color: [
          'rgba(248,113,113,0.75)',
          'rgba(248,113,113,0.30)',
          'rgba(255,255,255,0.04)',
          'rgba(37,232,137,0.30)',
          'rgba(37,232,137,0.75)',
        ],
      },
    },
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: { value: [number, number, number] }) => {
        const [colIdx, rowIdx, val] = p.value;
        const strike = strikes[rowIdx];
        const expLabel = expiries[colIdx].label;
        const col = val >= 0 ? '#25e889' : '#FF5F57';
        return `<div style="font-weight:bold;margin-bottom:4px">${fmtK(strike)} · ${expLabel}</div>` +
               `<span style="color:${col}">●</span> ${mode === 'vanna' ? 'Vanna' : 'Charm'}×OI: <b>${fmtVal(val)}</b>`;
      },
    },
    series: [{
      name: mode === 'vanna' ? 'Vanna' : 'Charm',
      type: 'heatmap' as const,
      data: heatData,
      label: {
        show: true,
        fontSize: 9,
        color: 'rgba(255,255,255,0.7)',
        formatter: (p: { value: [number, number, number] }) => fmtVal(p.value[2]),
      },
      itemStyle: { borderColor: 'rgba(255,255,255,0.04)', borderWidth: 1 },
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Description */}
      <div className="px-3 pt-1.5 pb-1 shrink-0">
        <p className="text-[9px] text-white/25 leading-relaxed">
          {mode === 'vanna'
            ? 'Vanna = ∂Δ/∂σ · IV 每涨 1% 时 Delta 的变化 · 做市商 Vanna 对冲会推动行情沿高 Vanna 区加速'
            : 'Charm = ∂Δ/∂t · Delta 每日自然衰减量 · 近到期大 Charm 区是 Pin Risk 来源'}
        </p>
      </div>

      {/* Heatmap — ECharts */}
      <div className="flex-1 min-h-0 px-2 pb-1">
        <EChart option={heatOption} />
      </div>

      <div className="px-3 pb-1.5 text-[9px] text-white/15 shrink-0">
        数值 = Σ({mode === 'vanna' ? 'Vanna' : 'Charm'} × OI) · 绿=正 红=负 · ◆现货 · Deribit
      </div>
    </div>
  );
});
export const DollarGreeksWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

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
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/45">{s.label}</span>
          </div>
          <div className="font-mono text-[15px] font-bold leading-tight" style={{ color: s.color }}>
            {s.val}
          </div>
          <div className="text-[9px] text-white/25 mt-0.5 leading-snug">{s.sub}</div>
        </div>
      ))}
    </div>
  );
});
export const RVvsIVTenorWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data }                    = useDeribitOptions(coin);
  const { data: hist, timedOut }    = useDeribitHistory(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && hist && <LiveBadge />}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  const option = {
    legend: {
      data: [
        { name: 'IV (当前)', icon: 'roundRect', itemStyle: { color: BRAND } },
        { name: 'RV (历史)', icon: 'roundRect', itemStyle: { color: BLUE } },
      ],
      textStyle: { color: 'rgba(255,255,255,0.5)', fontSize: 10 },
      right: 12, top: 0,
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 'bold' },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, formatter: (v: number) => v.toFixed(0) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    series: [
      {
        name: 'RV (历史)',
        type: 'bar' as const,
        barWidth: '32%',
        itemStyle: { color: BLUE, opacity: 0.55, borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top' as const, fontSize: 9, color: BLUE, formatter: (p: { value: number }) => p.value.toFixed(0) },
        data: currentRV.map(v => +v.toFixed(2)),
      },
      {
        name: 'IV (当前)',
        type: 'bar' as const,
        barWidth: '32%',
        itemStyle: { color: BRAND, opacity: 0.75, borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top' as const, fontSize: 9, color: BRAND, formatter: (p: { value: number }) => p.value.toFixed(0) },
        data: currentIV.map(v => +v.toFixed(2)),
      },
    ],
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: Array<{ seriesName: string; value: number; color: string; axisValue: string; dataIndex: number }>) => {
        const idx = params[0].dataIndex;
        const vrp = vrpByTenor[idx];
        const head = `<div style="font-weight:bold;margin-bottom:4px">${params[0].axisValue}</div>`;
        const rows = params.map(p =>
          `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${p.value.toFixed(1)}%</b>`
        ).join('<br/>');
        const vrpCol = vrp >= 8 ? '#FF5F57' : vrp >= 3 ? '#FEBC2E' : vrp <= 0 ? '#25e889' : '#666';
        const vrpLine = `<br/><span style="color:${vrpCol}">VRP</span>: <b>${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}pp</b>`;
        return head + rows + vrpLine;
      },
    },
    grid: { left: 36, right: 12, top: 24, bottom: 24 },
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* VRP pills */}
      <div className="flex gap-1.5 px-3 pt-2 pb-1 shrink-0 flex-wrap">
        {labels.map((lbl, i) => {
          const vrp = vrpByTenor[i];
          const col = vrp >= 8 ? '#FF5F57' : vrp >= 3 ? '#FEBC2E' : vrp <= 0 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div key={lbl} className="flex items-center gap-1 bg-white/[0.02] border border-white/[0.06] rounded-[6px] px-2 py-0.5">
              <span className="text-[9px] text-white/50">{lbl}</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: col }}>
                VRP {vrp >= 0 ? '+' : ''}{vrp.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {/* ECharts grouped bars — hover 看 IV/RV/VRP，pill 颜色编码 VRP 区间 */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        <EChart option={option} />
      </div>
    </div>
  );
});
export const CalendarSpreadWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

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
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        ATM IV 日历价差（近端 → 远端，vol pts）
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 flex flex-col gap-1.5">
        {rows.map(r => {
          const barW = (Math.abs(r.spreadVol) / maxAbsVol) * 100;
          const color = r.spreadVol >= 0 ? 'var(--nexus-accent)' : 'var(--nexus-red)';
          return (
            <div key={r.label} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400">{r.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-slate-500">{r.nearIV.toFixed(1)}% → {r.farIV.toFixed(1)}%</span>
                  <span className="text-[11px] font-mono font-bold tnum w-[60px] text-right"
                    style={{ color }}>
                    {r.spreadVol >= 0 ? '+' : ''}{r.spreadVol.toFixed(1)}vp
                  </span>
                  <span className="text-[9px] font-mono w-[44px] text-right"
                    style={{ color: r.spreadPct >= 0 ? '#64748b' : 'var(--nexus-red)' }}>
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
});
export const ForwardVolWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

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
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        隐含远期波动率（σ_fwd）vs 即期 ATM IV
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal">区间</th>
              <th className="text-right pb-1.5 font-normal">近端IV</th>
              <th className="text-right pb-1.5 font-normal">远端IV</th>
              <th className="text-right pb-1.5 font-normal">远期σ</th>
              <th className="text-right pb-1.5 font-normal">溢价</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const premColor = r.premium > 2 ? 'var(--nexus-green)' : r.premium < -2 ? 'var(--nexus-red)' : '#94a3b8';
              return (
                <tr key={r.pair} className="border-t border-white/4">
                  <td className="py-1.5 text-slate-400 text-[9px]">{r.pair}</td>
                  <td className="py-1.5 text-right text-slate-400">{r.iv1.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-slate-400">{r.iv2.toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-bold text-slate-200">{r.fwdVol.toFixed(1)}%</td>
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
});
