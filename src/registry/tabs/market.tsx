import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TabGroup, TabList, Tab } from "@headlessui/react";
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
export const VolOverviewWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  // 期限结构 ATM IV 柱状图最大高度（按可用空间撑大）
  const termBarMax = 120;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {loading && !data && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-[11px] text-white/20">正在加载实时数据…</span>
        </div>
      )}
      <div className="mx-2 mt-2 mb-2 rounded-[8px] bg-surface-1/40 border border-surface-4/50 overflow-hidden shrink-0">
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
      </div>
      {/* Term structure — 撑满剩余空间 */}
      <div className="mx-2 mb-2 flex-1 min-h-0 rounded-[8px] bg-surface-1/40 border border-surface-4/50 px-3 pt-2 pb-2.5 flex flex-col">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">期限结构 ATM IV</div>
          {data && <LiveBadge />}
        </div>
        <div className="flex-1 min-h-0 flex gap-1 items-end" style={{ maxHeight: termBarMax }}>
          {termItems.map((t, i) => {
            const barRatio = (t.iv - termMin) / termRange; // 0..1
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
                <span className="text-[8px] font-mono tnum text-slate-500 leading-none">{t.iv.toFixed(1)}</span>
                <div
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: `${20 + barRatio * 75}%`,
                    background: 'linear-gradient(to top,rgba(37,232,137,.65),rgba(37,232,137,.18))',
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-1 shrink-0">
          {termItems.map((t, i) => (
            <div key={i} className="flex-1 flex justify-center">
              <span className="text-[9px] text-slate-600 font-mono">{t.t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
export const LiveOptionsChainWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
        {data && <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />实时</span>}
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  useEffect(() => { setSelectedExp(0); }, [coin]);

  // Build strike table data (memoised-equivalent, before early returns for hook ordering)
  const chainData = useMemo(() => {
    if (!exp) return null;
    const cMap = new Map<number, typeof exp.calls[0]>();
    const pMap = new Map<number, typeof exp.puts[0]>();
    exp.calls.forEach(o => cMap.set(o.strike, o));
    exp.puts.forEach(o => pMap.set(o.strike, o));
    const strikes = [...new Set([...cMap.keys(), ...pMap.keys()])]
      .filter(k => k >= spot * 0.75 && k <= spot * 1.25)
      .sort((a, b) => b - a);
    const atm = strikes.reduce(
      (best, k) => Math.abs(k - spot) < Math.abs(best - spot) ? k : best,
      strikes[0] ?? spot,
    );
    return { cMap, pMap, strikes, atm };
  }, [exp, spot]);

  // Virtual scrolling — must be called before any early return (rules of hooks)
  const scrollRef = useRef<HTMLDivElement>(null);
  const ROW_H = 32;
  const COL = 'grid-cols-[1fr_44px_48px_1.15fr_48px_44px_1fr]';
  const virtualizer = useVirtualizer({
    count: chainData?.strikes.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  if (loading && !data) return <Skeleton />;
  if (!exp || !chainData) return <div className="p-4 text-[11px] text-white/20">暂无数据</div>;

  const { cMap: callsByStrike, pMap: putsByStrike, strikes: allStrikes, atm: atmStrike } = chainData;
  const fmt = (v: number) => v > 0 ? v.toFixed(1) : '—';
  const fmtOI = (v: number) => v > 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Expiry tabs — Headless UI TabGroup */}
      <TabGroup selectedIndex={selectedExp} onChange={setSelectedExp}>
        <TabList className="flex gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
          {expiries.map((e, i) => (
            <Tab
              key={e.label}
              className={cn(
                'px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-colors shrink-0 outline-none',
                'text-white/45 hover:text-white/60 hover:bg-white/[0.04]',
                'data-[selected]:bg-[var(--nexus-accent)]/15 data-[selected]:text-[var(--nexus-accent)]',
              )}
            >
              {e.label}
            </Tab>
          ))}
        </TabList>
      </TabGroup>

      {/* Column headers (outside scroll) */}
      <div className={cn('grid px-3 pt-1.5 pb-1 shrink-0 border-b border-white/[0.06]', COL)}>
        <span className="text-right text-[9px] uppercase tracking-wider text-white/25">IV%</span>
        <span className="text-right text-[9px] uppercase tracking-wider text-white/25">Δ</span>
        <span className="text-right text-[9px] uppercase tracking-wider text-white/25">OI</span>
        <span className="text-center text-[9px] uppercase tracking-wider text-white/50 font-semibold bg-white/[0.03]">行权价</span>
        <span className="text-left text-[9px] uppercase tracking-wider text-white/25">OI</span>
        <span className="text-left text-[9px] uppercase tracking-wider text-white/25">Δ</span>
        <span className="text-left text-[9px] uppercase tracking-wider text-white/25">IV%</span>
      </div>
      <div className={cn('grid px-3 pb-1.5 shrink-0 border-b border-white/[0.03]', COL)}>
        <span className="text-center text-[8px] text-emerald-400/40 col-span-3">CALL</span>
        <span className="bg-white/[0.03]" />
        <span className="text-center text-[8px] text-rose-400/40 col-span-3">PUT</span>
      </div>

      {/* Virtualized rows */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const strike = allStrikes[virtualRow.index];
            const call = callsByStrike.get(strike);
            const put  = putsByStrike.get(strike);
            const isAtm = strike === atmStrike;
            const aboveSpot = strike > spot;
            return (
              <div
                key={strike}
                className={cn(
                  'grid items-center px-3 border-b border-white/[0.03] hover:bg-white/[0.03]',
                  isAtm && 'bg-[var(--nexus-accent)]/[0.04]',
                  COL,
                )}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  height: ROW_H, transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className={cn('text-right font-mono tnum text-[11px]', aboveSpot ? 'text-white/45' : 'text-emerald-400/80')}>
                  {call ? fmt(call.iv) : '—'}
                </span>
                <span className="text-right font-mono tnum text-[11px] text-white/50">
                  {call ? call.delta.toFixed(2) : '—'}
                </span>
                <span className="text-right font-mono tnum text-[11px] text-white/50">
                  {call ? fmtOI(call.oi) : '—'}
                </span>
                <span className={cn('text-center font-mono font-bold text-[11px] bg-white/[0.03]', isAtm ? 'text-[var(--nexus-accent)]' : 'text-white/70')}>
                  {strike.toLocaleString()}
                  {isAtm && <span className="ml-1 text-[8px] text-[var(--nexus-accent)]/60">ATM</span>}
                </span>
                <span className="text-left font-mono tnum text-[11px] text-white/50">
                  {put ? fmtOI(put.oi) : '—'}
                </span>
                <span className="text-left font-mono tnum text-[11px] text-white/50">
                  {put ? put.delta.toFixed(2) : '—'}
                </span>
                <span className={cn('text-left font-mono tnum text-[11px]', aboveSpot ? 'text-rose-400/80' : 'text-white/45')}>
                  {put ? fmt(put.iv) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        现货 {spot > 0 ? spot.toLocaleString() : '—'} · {exp.label} 到期 · OI 单位：张
      </div>
    </div>
  );
});
export const BlockTradeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
                minUSD === v ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
              )}>
              {v >= 1_000_000 ? `${v/1_000_000}M+` : `${v/1_000}K+`}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />10s
        </span>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>
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

  // Virtual scrolling
  const btScrollRef = useRef<HTMLDivElement>(null);
  const BT_ROW_H = 36;
  const btVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => btScrollRef.current,
    estimateSize: () => BT_ROW_H,
    overscan: 6,
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header row */}
      <div className="grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['时间', '合约', '方向', 'IV', '规模', '名义金额'].map(h => (
          <span key={h} className="text-[9px] uppercase tracking-[0.06em] text-white/20 font-bold">{h}</span>
        ))}
      </div>

      {loading && filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/20">等待成交…</div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-white/20">暂无达到阈值的大宗成交</div>
      ) : (
        <div ref={btScrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div style={{ height: btVirtualizer.getTotalSize(), position: 'relative' }}>
            {btVirtualizer.getVirtualItems().map(virtualRow => {
              const t = filtered[virtualRow.index];
              const isBuy = t.direction === 'buy';
              const dirColor = isBuy ? '#25e889' : '#FF5F57';
              const typeColor = t.optType === 'C' ? '#4ea1ff' : '#FEBC2E';
              const sizeEmphasis = t.notionalUSD >= 1_000_000;
              return (
                <div
                  key={t.tradeId}
                  className={cn(
                    'grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-2 border-b border-white/[0.025] hover:bg-white/[0.02] items-center',
                    virtualRow.index === 0 && 'bg-white/[0.015]',
                  )}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%',
                    height: BT_ROW_H, transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <span className="font-mono text-[10px] text-white/45">{relTime(t.ts)}</span>
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] font-semibold" style={{ color: typeColor }}>{t.optType}</span>
                    <span className="font-mono text-[10px] text-white/55 ml-1">{t.strike.toLocaleString()} · {t.expiry}</span>
                  </div>
                  <span className="font-mono text-[10px] font-bold" style={{ color: dirColor }}>{isBuy ? 'BUY' : 'SELL'}</span>
                  <span className="font-mono text-[10px] text-white/50 tnum">{t.iv > 0 ? `${t.iv.toFixed(1)}%` : '—'}</span>
                  <span className="font-mono text-[10px] text-white/50 tnum">{t.amount >= 1000 ? `${(t.amount / 1000).toFixed(1)}K` : t.amount.toFixed(1)}</span>
                  <span className={cn('font-mono text-[10px] tnum font-bold', sizeEmphasis ? 'text-amber-400' : 'text-white/50')}>{fmtUSD(t.notionalUSD)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        名义金额 = 合约数 × 指数价格 · 仅显示 ≥ {fmtUSD(minUSD)} 的成交 · Deribit
      </div>
    </div>
  );
});
export const IVSignalWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading }    = useDeribitOptions(coin);
  const { data: histData }   = useDeribitHistory(coin);
  const { data: flowData }   = useFlowData(coin);
  const { setHeaderRight }   = useCardHeader();

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
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无信号数据</div>;

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
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/45 truncate">{sig.label}</span>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: severityColor(sig.severity), boxShadow: `0 0 5px ${severityColor(sig.severity)}88` }}
            />
          </div>
          <div className="font-mono text-[15px] font-bold leading-none mb-1.5" style={{ color: severityColor(sig.severity) }}>
            {sig.value}
          </div>
          <div className="text-[9px] text-white/45 leading-snug line-clamp-2">{sig.desc}</div>
        </div>
      ))}
    </div>
  );
});
export const ImpliedMoveWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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

  // Use up to 8 expiries
  const exps = data.expiries.slice(0, 8);
  const SQRT_2_PI = Math.sqrt(2 / Math.PI); // ≈ 0.7979

  const rows = exps.map(e => {
    // ExpiryGroup doesn't carry `T` directly — compute it from daysToExp.
    const T = e.daysToExp / 365;
    const movePct = (e.atmIV / 100) * Math.sqrt(T) * SQRT_2_PI * 100;
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
              <span className="text-[9px] text-white/25 font-mono">{r.atmIV.toFixed(1)}%</span>
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
});
export const SpotTickerWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevSpotRef = useRef<number | undefined>(undefined);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snap = React.useDeferredValue(useTickerSnapshotWS(coin));

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
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
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>
  );

  const fmtPrice = (p: number) => {
    const n = Number(p);
    if (!Number.isFinite(n)) return '—';
    return n >= 10000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2);
  };

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div className="flex flex-col items-center gap-0.5 min-w-[64px]">
      <span className="text-[9px] text-slate-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <span className="text-[13px] font-mono font-bold tnum leading-none" style={{ color: color ?? 'var(--nexus-accent)' }}>{value}</span>
    </div>
  );

  const flashBg = flash === 'up' ? 'rgba(37,167,80,0.06)' : flash === 'down' ? 'rgba(244,63,94,0.06)' : 'transparent';
  const priceColor = flash === 'up' ? 'var(--nexus-green)' : flash === 'down' ? 'var(--nexus-red)' : '#e2e8f0';
  const upColor = 'var(--nexus-green)';
  const dnColor = 'var(--nexus-red)';

  return (
    <div className="w-full h-full flex items-center justify-around px-6 transition-colors duration-500" style={{ background: flashBg }}>
      {/* Spot price + 24h change */}
      <div className="flex flex-col items-center">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">{coin} / USD</span>
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
});
export const SentimentCompositeWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [result, setResult] = useState<{ composite: number; factors: SentFactor[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<{ composite: number; factors: SentFactor[] }>(
      `sentiment-${coin}`,
      () => computeSentiment(coin),
      120_000, // 2 min — underlying options/flow data refreshes at 300s max
      r => { if (alive) { setResult(r); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading || !result) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const { composite, factors } = result;
  const label  = composite >= 70 ? '极度乐观' : composite >= 55 ? '偏多'   : composite >= 45 ? '中性' : composite >= 30 ? '偏空' : '极度悲观';
  const color  = composite >= 70 ? '#28C840'  : composite >= 55 ? '#5DD879' : composite >= 45 ? '#94a3b8' : composite >= 30 ? '#FF8C57' : '#FF5F57';

  // ECharts gauge — 只画弧+指针，文字交给 HTML 控制（避免在 116px 容器里挤）
  const score = Math.round(composite);
  const gaugeOption = {
    grid: undefined,
    tooltip: { show: false },
    series: [{
      type: 'gauge' as const,
      startAngle: 180, endAngle: 0,
      min: 0, max: 100,
      radius: '95%',
      center: ['50%', '95%'],
      progress: {
        show: true,
        width: 8,
        roundCap: true,
        itemStyle: { color, shadowBlur: 6, shadowColor: `${color}88` },
      },
      axisLine: {
        roundCap: true,
        lineStyle: { width: 8, color: [[1, 'rgba(255,255,255,0.08)']] as Array<[number, string]> },
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { width: 3, length: '78%', itemStyle: { color } },
      anchor: { show: true, size: 7, itemStyle: { color } },
      title: { show: false },
      detail: { show: false },
      data: [{ value: score }],
    }],
  };

  const factorColor = (s: number) =>
    s >= 65 ? '#28C840' : s >= 45 ? '#94a3b8' : '#FF5F57';

  return (
    <div className="w-full h-full flex items-center gap-6 px-4">
      {/* Gauge — 上方弧+指针(EChart)，下方数字+标签(HTML) */}
      <div className="shrink-0 flex flex-col items-center" style={{ width: 160 }}>
        <div className="relative w-[160px] h-[88px]">
          <EChart option={gaugeOption} />
          {/* 熊/牛 锚点贴在弧形两端 */}
          <span className="absolute text-[9px] text-slate-500 pointer-events-none" style={{ left: 14, bottom: 0 }}>熊</span>
          <span className="absolute text-[9px] text-slate-500 pointer-events-none" style={{ right: 14, bottom: 0 }}>牛</span>
        </div>
        {/* 数字 + 标签 */}
        <div className="flex flex-col items-center mt-1 leading-none">
          <span className="text-[20px] font-bold font-mono" style={{ color }}>{score}</span>
          <span className="text-[10px] font-semibold mt-1" style={{ color }}>{label}</span>
        </div>
      </div>

      {/* Factor pills */}
      <div className="flex-1 grid grid-cols-3 gap-2">
        {factors.map(f => (
          <div key={f.label}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg border"
            style={{ borderColor: `${factorColor(f.score)}30`, background: `${factorColor(f.score)}0a` }}>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[9px] text-slate-500 uppercase tracking-wider">{f.label}</span>
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
});
export const OrderbookDepthWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const ob = React.useDeferredValue(useOrderbookWS(coin));

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (!ob) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const ROWS = Math.min(ob.bids.length, ob.asks.length, 12);
  // Cumulative sizes for bar width normalisation
  let cumBid = 0; let cumAsk = 0;
  const bidRows = ob.bids.slice(0, ROWS).map(([p, s]) => { cumBid += s; return { p, s, cum: cumBid }; });
  const askRows = ob.asks.slice(0, ROWS).map(([p, s]) => { cumAsk += s; return { p, s, cum: cumAsk }; });
  const maxCum = Math.max(cumBid, cumAsk, 1);
  const fmtPrice = (p: number) => {
    const n = Number(p);
    if (!Number.isFinite(n)) return '—';
    return n >= 10000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2);
  };
  const fmtSize  = (s: number) => s >= 1000 ? `${(s / 1000).toFixed(1)}K` : s.toFixed(1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Header: mark price + spread */}
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0 border-b border-white/6">
        <span className="text-[10px] font-mono text-slate-400">
          Mark <span className="text-slate-200 font-bold">{fmtPrice(ob.mark)}</span>
        </span>
        <span className="text-[9px] font-mono text-slate-500">
          Spread {fmtPrice(ob.spread)} ({ob.mark > 0 ? (ob.spread / ob.mark * 100).toFixed(3) : '—'}%)
        </span>
      </div>
      {/* Column labels */}
      <div className="grid px-3 py-0.5 shrink-0" style={{ gridTemplateColumns: '1fr 60px 8px 60px 1fr' }}>
        <span className="text-[8px] text-slate-600 text-left">深度</span>
        <span className="text-[8px] text-slate-600 text-right">买价</span>
        <span />
        <span className="text-[8px] text-slate-600 text-left">卖价</span>
        <span className="text-[8px] text-slate-600 text-right">深度</span>
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
                {bid && <span className="absolute left-0 text-[8px] font-mono text-slate-600">{fmtSize(bid.s)}</span>}
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
                {ask && <span className="absolute right-0 text-[8px] font-mono text-slate-600">{fmtSize(ask.s)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
export const AlertsWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [alerts, setAlerts] = useState<UserAlert[]>([...ALERTS_STORE]);
  const [metric, setMetric] = useState<AlertMetric>('spot');
  const [op, setOp]         = useState<AlertOp>('>');
  const [thresh, setThresh] = useState('');

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  // Request browser notification permission once on mount
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => { /* ignore */ });
    }
  }, []);

  // Evaluate alerts every 30s — reads only from in-memory caches, no network
  useEffect(() => {
    let alive = true;
    const tick = () => { evalAlerts(coin); if (alive) setAlerts([...ALERTS_STORE]); };
    tick();
    const stop = setVisibleInterval(tick, 30_000);
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
          className="text-[10px] bg-transparent border border-white/10 rounded px-1.5 py-1 text-slate-300 outline-none">
          {(Object.keys(METRIC_META) as AlertMetric[]).map(m => (
            <option key={m} value={m}>{METRIC_META[m].label}</option>
          ))}
        </select>
        <select value={op} onChange={e => setOp(e.target.value as AlertOp)}
          className="w-[44px] text-[10px] bg-transparent border border-white/10 rounded px-1 py-1 text-slate-300 outline-none">
          <option value=">">{'>'}</option>
          <option value="<">{'<'}</option>
        </select>
        <input
          value={thresh}
          onChange={e => setThresh(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addAlert()}
          placeholder={`${meta.defaultVal} ${meta.unit}`}
          className="w-[88px] bg-transparent text-[10px] font-mono text-slate-200 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-slate-700"
        />
        <button onClick={addAlert}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 hover:bg-white/8 transition-colors">
          + 添加
        </button>
      </div>

      {alerts.filter(a => a.coin === coin).length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
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
                <span className="flex-1 text-[10px] font-mono text-slate-300">
                  {m.label} {a.op} <span className="font-bold text-slate-100">{fmtVal(a.threshold)}</span> {m.unit}
                </span>
                {/* Current value */}
                <span className="text-[10px] font-mono text-slate-500">
                  现值 <span style={{ color: a.triggered ? ringColor : '#94a3b8' }}>{fmtVal(a.lastValue)}</span>
                </span>
                {/* Triggered time */}
                {a.triggeredAt && (
                  <span className="text-[9px] text-slate-600">
                    {new Date(a.triggeredAt).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {/* Toggle + remove */}
                <button onClick={() => toggleAlert(a.id)}
                  className="text-[9px] px-1.5 py-0.5 rounded border border-white/8 transition-colors"
                  style={{ color: a.active ? '#94a3b8' : '#475569' }}>
                  {a.active ? '启用' : '暂停'}
                </button>
                <button onClick={() => removeAlert(a.id)}
                  className="text-[9px] text-slate-700 hover:text-rose-400 transition-colors">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
