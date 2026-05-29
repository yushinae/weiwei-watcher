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
  POS_STORE, POS_TICKER_CACHE, buildLiveFromCache,
  subscribePositions, addPosition, removePositionById,
  loadAlerts, ALERTS_STORE, saveAlerts, METRIC_META, evalAlerts,
  parseInstForPayoff,
  CONE_TENORS,
} from "../monitorWidgetsBase";
export const StrategyPricerWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
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
  if (!data || !data.expiries.length) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  // Use up to 4 near-dated expiries
  const exps = data.expiries.slice(0, 4);

  const fmtPct = (v: number) => `${v >= 0 ? '' : ''}${v.toFixed(2)}%`;
  const fmtUSD = (v: number) => {
    if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(0)}`;
  };

  const rows = exps.map(e => {
    const { calls, puts, atmIV, rr25, daysToExp, label } = e;
    // ExpiryGroup 提供 daysToExp（天），BS 函数需要 T（年）
    const T = daysToExp / 365;

    // ATM straddle: 2× ATM call (since ATM call = ATM put when r=q=0)
    // bsCall 返回 USD per coin（与 S 同单位），1 contract = 1 coin
    const straddlePerCoin = 2 * bsCall(spot, spot, T, atmIV);
    const straddlePct     = (straddlePerCoin / spot) * 100;
    const straddleUSD     = straddlePerCoin; // USD cost per contract
    const upBE   = spot * (1 + straddlePct / 100);
    const downBE = spot * (1 - straddlePct / 100);

    // 25D strangle: call closest to 0.25 delta + put closest to 0.25 delta (abs)
    const call25 = calls.reduce((best, o) =>
      Math.abs(o.delta - 0.25) < Math.abs(best.delta - 0.25) ? o : best, calls[0]);
    const put25  = puts.reduce((best, o) =>
      Math.abs(Math.abs(o.delta) - 0.25) < Math.abs(Math.abs(best.delta) - 0.25) ? o : best, puts[0]);

    const stranglePct = call25 && put25
      ? ((bsCall(spot, call25.strike, T, call25.iv) + bsPut(spot, put25.strike, T, put25.iv)) / spot) * 100
      : null;

    // Strangle width (distance between the two wings as % of spot)
    const strangleWidth = call25 && put25
      ? ((call25.strike - put25.strike) / spot) * 100
      : null;

    return { label, daysToExp, straddlePct, straddleUSD, upBE, downBE, stranglePct, strangleWidth, rr25, atmIV };
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Column headers */}
      <div className="grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期', 'ATM IV', 'Straddle', '上行 BE', '下行 BE', '25δ Strangle', 'RR25'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((r, i) => {
          const isNear = r.daysToExp <= 7;
          const rrColor = r.rr25 < -3 ? '#FF5F57' : r.rr25 > 3 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-2.5 border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors items-center',
                isNear && 'bg-amber-500/[0.03]',
              )}
            >
              {/* Expiry label */}
              <div>
                <div className={cn('font-mono text-[11px] font-bold', isNear ? 'text-amber-400' : 'text-white/60')}>
                  {r.label}
                </div>
                <div className="text-[8.5px] text-white/20">{r.daysToExp}天</div>
              </div>

              {/* ATM IV */}
              <span className="font-mono text-[11px] text-white/55">{r.atmIV.toFixed(1)}%</span>

              {/* Straddle */}
              <div>
                <div className="font-mono text-[11px] font-bold text-[#a78bfa]">{fmtPct(r.straddlePct)}</div>
                <div className="text-[8.5px] text-white/20">{fmtUSD(r.straddleUSD)}</div>
              </div>

              {/* Up breakeven */}
              <div>
                <div className="font-mono text-[10.5px] text-[#25e889]">{fmtUSD(r.upBE)}</div>
                <div className="text-[8.5px] text-white/20">+{r.straddlePct.toFixed(2)}%</div>
              </div>

              {/* Down breakeven */}
              <div>
                <div className="font-mono text-[10.5px] text-[#FF5F57]">{fmtUSD(r.downBE)}</div>
                <div className="text-[8.5px] text-white/20">-{r.straddlePct.toFixed(2)}%</div>
              </div>

              {/* 25D Strangle */}
              <span className="font-mono text-[11px] text-[#FEBC2E]">
                {r.stranglePct !== null ? fmtPct(r.stranglePct) : '—'}
                {r.strangleWidth !== null && (
                  <span className="text-[8.5px] text-white/20 ml-1">±{r.strangleWidth.toFixed(0)}%</span>
                )}
              </span>

              {/* RR25 */}
              <span className="font-mono text-[11px] font-bold" style={{ color: rrColor }}>
                {r.rr25 >= 0 ? '+' : ''}{r.rr25.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        Straddle = 2× ATM Call（BS，r=0）· 25δ Strangle = 25δCall + 25δPut · BE = 现货 ± Straddle% · Deribit
      </div>
    </div>
  );
});
export const WatchlistWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  // watchlist as React state so re-subscriptions fire on add/remove
  const [watchlist, setWatchlist] = useState<string[]>(() => [...WATCHLIST_SET]);
  const [items, setItems] = useState<WatchItem[]>(() =>
    [...WATCHLIST_SET].map(inst => WATCH_CACHE.get(inst)).filter(Boolean) as WatchItem[]
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  // Subscribe to ticker WS for each instrument; re-runs whenever watchlist changes.
  // WS callbacks write to WATCH_CACHE (no React state); a 500ms flush interval
  // batches all N per-instrument updates into a single setItems call.
  const watchlistDirtyRef = useRef(false);
  useEffect(() => {
    if (watchlist.length === 0) { setItems([]); return; }
    watchlistDirtyRef.current = false;
    const unsubs = watchlist.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.100ms`, (d) => {
        const oi: number = d.open_interest ?? 0;
        if (!WATCH_OI_SNAP.has(inst)) WATCH_OI_SNAP.set(inst, oi);
        WATCH_CACHE.set(inst, {
          instrument: inst, bid: d.best_bid_price ?? 0, ask: d.best_ask_price ?? 0,
          iv: d.mark_iv ?? 0, delta: d.greeks?.delta ?? 0, mark: d.mark_price ?? 0,
          oi, oiDelta: oi - (WATCH_OI_SNAP.get(inst) ?? oi), ts: Date.now(),
        });
        watchlistDirtyRef.current = true;
      })
    );
    // Flush all pending WS updates at most every 500ms → single re-render
    const flush = setInterval(() => {
      if (!watchlistDirtyRef.current || _shouldSkip()) return;
      watchlistDirtyRef.current = false;
      setItems(watchlist.map(w => WATCH_CACHE.get(w)).filter(Boolean) as WatchItem[]);
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
    WATCH_CACHE.delete(inst);
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
          className="flex-1 bg-transparent text-[10px] font-mono text-slate-200 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-slate-700"
        />
        <button onClick={addInstrument}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 hover:bg-white/8 transition-colors">
          + 添加
        </button>
        {error && <span className="text-[9px] text-rose-400">{error}</span>}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          输入合约代码并回车添加…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          {/* Column header */}
          <div className="grid px-3 py-1 text-[8px] text-slate-600 uppercase tracking-wider border-b border-white/4"
            style={{ gridTemplateColumns: '1fr 56px 56px 44px 44px 50px 50px 24px' }}>
            <span>合约</span><span className="text-right">Bid</span><span className="text-right">Ask</span>
            <span className="text-right">IV</span><span className="text-right">Δ</span>
            <span className="text-right">OI</span><span className="text-right">OIΔ</span><span />
          </div>
          {items.map(item => {
            const oiColor = item.oiDelta > 0 ? 'var(--nexus-green)' : item.oiDelta < 0 ? 'var(--nexus-red)' : '#64748b';
            return (
              <div key={item.instrument}
                className="grid items-center px-3 py-1.5 border-b border-white/4 hover:bg-white/2 transition-colors"
                style={{ gridTemplateColumns: '1fr 56px 56px 44px 44px 50px 50px 24px' }}>
                <span className="text-[9px] font-mono text-slate-300 truncate">{item.instrument}</span>
                <span className="text-right text-[9px] font-mono text-slate-400">{item.bid.toFixed(4)}</span>
                <span className="text-right text-[9px] font-mono text-slate-400">{item.ask.toFixed(4)}</span>
                <span className="text-right text-[9px] font-mono text-slate-200">{item.iv.toFixed(1)}%</span>
                <span className="text-right text-[9px] font-mono"
                  style={{ color: item.delta > 0 ? 'var(--nexus-green)' : 'var(--nexus-red)' }}>
                  {item.delta.toFixed(2)}
                </span>
                <span className="text-right text-[9px] font-mono text-slate-400">{item.oi.toFixed(0)}</span>
                <span className="text-right text-[9px] font-mono font-bold" style={{ color: oiColor }}>
                  {item.oiDelta > 0 ? '+' : ''}{item.oiDelta.toFixed(0)}
                </span>
                <button onClick={() => removeInstrument(item.instrument)}
                  className="text-[9px] text-slate-700 hover:text-rose-400 transition-colors text-right">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
export const RollCostWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useDeribitOptions(coin);

  useEffect(() => {
    setHeaderRight(<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/55 uppercase tracking-wider">{coin}</span>);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const S = ddata.spot;
  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  // Compute ATM straddle for each expiry
  const straddlePrices = exps.map(exp => {
    const allStrikes = [...exp.calls.map(c => c.strike), ...exp.puts.map(p => p.strike)];
    if (!allStrikes.length) return { exp, K: S, priceUSD: 0, pricePct: 0 };
    const K = allStrikes.reduce((best, s) => Math.abs(s - S) < Math.abs(best - S) ? s : best, allStrikes[0]);
    const T = Math.max(exp.daysToExp / 365, 0.001);
    const iv = exp.atmIV / 100;
    const priceCoins = bsCall(S, K, T, iv) + bsPut(S, K, T, iv); // in USD (r=q=0 → priceCoins is in same units as S)
    return { exp, K, priceUSD: priceCoins, pricePct: priceCoins / S * 100 };
  });

  interface RollRow { from: string; to: string; nearPriceUSD: number; farPriceUSD: number; rollUSD: number; rollVolPt: number }
  const rows: RollRow[] = [];
  for (let i = 0; i < straddlePrices.length - 1; i++) {
    const n = straddlePrices[i]; const f = straddlePrices[i + 1];
    rows.push({
      from: n.exp.label, to: f.exp.label,
      nearPriceUSD: n.priceUSD, farPriceUSD: f.priceUSD,
      rollUSD: f.priceUSD - n.priceUSD,
      rollVolPt: f.exp.atmIV - n.exp.atmIV,
    });
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="px-3 pt-1 pb-0.5 shrink-0 text-[9px] text-slate-600">
        ATM Straddle 展期成本（近 → 远）· 正=需要支付溢价
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-2">
        <table className="w-full text-[10px] font-mono border-collapse">
          <thead>
            <tr className="text-[8px] text-slate-600 uppercase tracking-wider">
              <th className="text-left pb-1.5 font-normal">近端</th>
              <th className="text-left pb-1.5 font-normal">远端</th>
              <th className="text-right pb-1.5 font-normal">近端价格</th>
              <th className="text-right pb-1.5 font-normal">远端价格</th>
              <th className="text-right pb-1.5 font-normal">展期成本</th>
              <th className="text-right pb-1.5 font-normal">Δvol</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const rollColor = r.rollUSD > 0 ? 'var(--nexus-red)' : 'var(--nexus-green)';
              return (
                <tr key={`${r.from}-${r.to}`} className="border-t border-white/4">
                  <td className="py-1.5 text-slate-400 text-[9px]">{r.from}</td>
                  <td className="py-1.5 text-slate-400 text-[9px]">{r.to}</td>
                  <td className="py-1.5 text-right text-slate-300">${r.nearPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right text-slate-300">${r.farPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: rollColor }}>
                    {r.rollUSD >= 0 ? '+' : ''}${r.rollUSD.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right" style={{ color: r.rollVolPt >= 0 ? '#64748b' : 'var(--nexus-green)' }}>
                    {r.rollVolPt >= 0 ? '+' : ''}{r.rollVolPt.toFixed(1)}vp
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
export const PositionTrackerWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [positions, setPositions] = useState<UserPosition[]>([...POS_STORE]);
  const [live, setLive] = useState<LivePosition[]>(() => buildLiveFromCache([...POS_STORE]));
  const [input, setInput] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  // Sync local state when any other widget mutates POS_STORE.
  useEffect(() => subscribePositions(() => setPositions([...POS_STORE])), []);

  // Subscribe to ticker WS for each unique instrument; re-runs when positions change.
  // Callbacks write to POS_TICKER_CACHE; a 500ms interval flushes to React state.
  const posDirtyRef = useRef(false);
  useEffect(() => {
    if (positions.length === 0) { setLive([]); return; }
    posDirtyRef.current = false;
    const instruments = Array.from(new Set<string>(positions.map(p => p.instrument)));
    const unsubs = instruments.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.100ms`, (d) => {
        POS_TICKER_CACHE.set(inst, d);
        posDirtyRef.current = true;
      })
    );
    const flush = setInterval(() => {
      if (!posDirtyRef.current || _shouldSkip()) return;
      posDirtyRef.current = false;
      setLive(buildLiveFromCache(positions));
    }, WS_FLUSH_MS);
    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, [positions]);

  const onAddPosition = async () => {
    const inst = input.trim().toUpperCase();
    const qty  = parseFloat(qtyInput);
    if (!inst || isNaN(qty) || qty === 0) { setAddError('请输入合约和数量'); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      if (!res.result) { setAddError('合约不存在'); setLoading(false); return; }
      addPosition({ id: `${inst}-${Date.now()}`, instrument: inst, qty });
      setPositions([...POS_STORE]);
      setInput(''); setQtyInput('1'); setAddError('');
    } catch { setAddError('验证失败'); }
    setLoading(false);
  };

  const removePosition = (id: string) => {
    removePositionById(id);
    setPositions([...POS_STORE]);
  };

  // Aggregate Greeks
  const netDelta  = live.reduce((s, p) => s + p.dollarDelta, 0);
  const netGamma  = live.reduce((s, p) => s + p.dollarGamma, 0);
  const netVega   = live.reduce((s, p) => s + p.dollarVega,  0);
  const netTheta  = live.reduce((s, p) => s + p.dollarTheta, 0);

  // P&L estimates for ±5% spot moves using delta + gamma approximation
  const spotForPnL = live[0]?.spot ?? 0;
  const pnlUp5   = netDelta * 0.05 + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;
  const pnlDn5   = netDelta * (-0.05) + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;

  const fmtK = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}`;
  const gColor = (v: number) => v > 0 ? 'var(--nexus-green)' : v < 0 ? 'var(--nexus-red)' : '#64748b';

  const placeholder = coin === 'BTC' ? 'BTC-27JUN25-100000-C' : 'ETH-27JUN25-3000-P';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Add row */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 shrink-0 border-b border-white/6">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setAddError(''); }}
          onKeyDown={e => e.key === 'Enter' && onAddPosition()}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[10px] font-mono text-slate-200 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-slate-700"
        />
        <input
          value={qtyInput}
          onChange={e => setQtyInput(e.target.value)}
          placeholder="qty"
          className="w-[52px] bg-transparent text-[10px] font-mono text-center text-slate-200 border border-white/10 rounded px-1 py-1 outline-none focus:border-white/30"
        />
        <button onClick={onAddPosition} disabled={loading}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 hover:bg-white/8 transition-colors disabled:opacity-40">
          + 加仓
        </button>
        {addError && <span className="text-[9px] text-rose-400">{addError}</span>}
      </div>

      {/* Aggregate Greeks bar */}
      {live.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-1.5 shrink-0 border-b border-white/6 bg-white/2">
          {[
            { label: '$Δ', val: netDelta, title: '净美元Delta' },
            { label: '$Γ/1%', val: netGamma, title: '净Dollar Gamma per 1% spot' },
            { label: '$ν/1%', val: netVega, title: '净Dollar Vega per 1% IV' },
            { label: '$Θ/d', val: netTheta, title: '净Dollar Theta per day' },
          ].map(g => (
            <div key={g.label} className="flex flex-col items-center" title={g.title}>
              <span className="text-[8px] text-slate-600">{g.label}</span>
              <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(g.val) }}>
                {fmtK(g.val)}
              </span>
            </div>
          ))}
          <div className="h-8 w-px bg-white/8 mx-1" />
          <div className="flex flex-col items-center" title="Spot +5% P&L估算">
            <span className="text-[8px] text-slate-600">+5% P&L</span>
            <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(pnlUp5) }}>{fmtK(pnlUp5)}</span>
          </div>
          <div className="flex flex-col items-center" title="Spot -5% P&L估算">
            <span className="text-[8px] text-slate-600">-5% P&L</span>
            <span className="text-[11px] font-mono font-bold tnum" style={{ color: gColor(pnlDn5) }}>{fmtK(pnlDn5)}</span>
          </div>
        </div>
      )}

      {/* Position rows */}
      {positions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          输入合约代码和数量（负数=做空）…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          <div className="grid px-3 py-1 text-[8px] text-slate-600 uppercase tracking-wider border-b border-white/4"
            style={{ gridTemplateColumns: '1fr 40px 52px 44px 44px 44px 44px 20px' }}>
            <span>合约</span><span className="text-right">数量</span><span className="text-right">Mark</span>
            <span className="text-right">$Δ</span><span className="text-right">$Γ</span>
            <span className="text-right">$ν</span><span className="text-right">$Θ</span><span />
          </div>
          {live.map(p => (
            <div key={p.id}
              className="grid items-center px-3 py-1.5 border-b border-white/4 hover:bg-white/2 transition-colors"
              style={{ gridTemplateColumns: '1fr 40px 52px 44px 44px 44px 44px 20px' }}>
              <span className="text-[9px] font-mono text-slate-300 truncate" title={p.instrument}>{p.instrument}</span>
              <span className="text-right text-[9px] font-mono"
                style={{ color: p.qty > 0 ? 'var(--nexus-green)' : 'var(--nexus-red)' }}>
                {p.qty > 0 ? '+' : ''}{p.qty}
              </span>
              <span className="text-right text-[9px] font-mono text-slate-300">
                {p.error ? <span className="text-rose-400 text-[8px]">{p.error}</span> : p.mark.toFixed(4)}
              </span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarDelta) }}>{fmtK(p.dollarDelta)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarGamma) }}>{fmtK(p.dollarGamma)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarVega)  }}>{fmtK(p.dollarVega)}</span>
              <span className="text-right text-[9px] font-mono tnum" style={{ color: gColor(p.dollarTheta) }}>{fmtK(p.dollarTheta)}</span>
              <button onClick={() => removePosition(p.id)}
                className="text-[9px] text-slate-700 hover:text-rose-400 transition-colors text-right">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
export const PayoffProfileWidget = React.memo(() => {
  const { setHeaderRight } = useCardHeader();
  const [live, setLive] = useState<LivePosition[]>(() => buildLiveFromCache([...POS_STORE]));
  const [positions, setPositions] = useState<UserPosition[]>([...POS_STORE]);

  useEffect(() => {
    setHeaderRight(<span className="text-[9px] text-slate-600">基于当前 mark 价格，到期日盈亏</span>);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  // React to Tracker mutations via the store's pub/sub (no length polling).
  useEffect(() => subscribePositions(() => setPositions([...POS_STORE])), []);

  const payoffDirtyRef = useRef(false);
  useEffect(() => {
    if (positions.length === 0) { setLive([]); return; }
    setLive(buildLiveFromCache(positions));
    payoffDirtyRef.current = false;

    const instruments = Array.from(new Set<string>(positions.map(p => p.instrument)));
    const unsubs = instruments.map(inst =>
      DERIBIT_WS.subscribe<any>(`ticker.${inst}.100ms`, (d) => {
        POS_TICKER_CACHE.set(inst, d);
        payoffDirtyRef.current = true;
      })
    );
    const flush = setInterval(() => {
      if (!payoffDirtyRef.current || _shouldSkip()) return;
      payoffDirtyRef.current = false;
      setLive(buildLiveFromCache(positions));
    }, WS_FLUSH_MS);

    return () => { unsubs.forEach(u => u()); clearInterval(flush); };
  }, [positions]);

  if (positions.length === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
      请先在「持仓追踪」中添加合约
    </div>
  );

  // Use the first non-error position's spot as the reference price
  const livePositions = live.filter(p => !p.error);
  const spot = livePositions[0]?.spot ?? 0;
  if (!spot || livePositions.length === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
      加载中…
    </div>
  );

  // Build payoff curve: spot range ±35%, 160 steps
  const STEPS = 160;
  const lo = spot * 0.65; const hi = spot * 1.35;
  const xs = Array.from({ length: STEPS }, (_, i) => lo + (hi - lo) * i / (STEPS - 1));

  // For each position, compute payoff at expiry at each x.
  // IMPORTANT: use a common `spot` for all costUSD calculations so the cost
  // basis is consistent across positions that may have received WS data at
  // slightly different underlying prices.
  const ys = xs.map(x => {
    return livePositions.reduce((total, p) => {
      const parsed = parseInstForPayoff(p.instrument);
      if (!parsed) return total;
      const { K, type } = parsed;
      const intrinsic = type === 'C' ? Math.max(x - K, 0) : Math.max(K - x, 0);
      const costUSD   = p.mark * spot;          // mark (in coin) × spot → USD per contract
      const pnl       = (intrinsic - costUSD) * p.qty;
      return total + pnl;
    }, 0);
  });

  // Find breakevens (zero crossings)
  const breakevens: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i - 1] * ys[i] < 0) {
      const be = xs[i - 1] + (xs[i] - xs[i - 1]) * Math.abs(ys[i - 1]) / (Math.abs(ys[i - 1]) + Math.abs(ys[i]));
      breakevens.push(be);
    }
  }

  const maxLoss   = Math.min(...ys);
  const maxProfit = Math.max(...ys);

  // ECharts data: [spot, pnl] 二维点 + 上下分段的面积填充。
  // 用两条 series 实现盈/亏不同色：一条 pnl 用 'positive' 颜色但只填高于 0 的区域、
  // 另一条只填低于 0 的区域。简化做法：用 areaStyle origin: 0 + visualMap 分段着色。
  const fmtUsd = (v: number) =>
    `${v >= 0 ? '+' : '-'}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'K' : Math.abs(v).toFixed(0)}`;
  const fmtPx = (v: number) =>
    v >= 10000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(1);

  const lineData: Array<[number, number]> = xs.map((x, i) => [x, +ys[i].toFixed(2)]);

  const payoffOption = {
    grid: { left: 56, right: 18, top: 12, bottom: 22, containLabel: false },
    xAxis: {
      type: 'value' as const,
      min: lo, max: hi,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      axisTick: { show: false },
      axisLabel: {
        color: 'rgba(255,255,255,0.4)', fontSize: 9,
        formatter: (v: number) => `$${(v / 1000).toFixed(0)}K`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      scale: true,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9,
        formatter: (v: number) => fmtUsd(v) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: Array<{ axisValue: number; data: [number, number] }>) => {
        const p = params[0];
        if (!p || !p.data) return '';
        const [x, y] = p.data;
        const col = y >= 0 ? '#28C840' : '#FF5F57';
        return `<b>Spot $${fmtPx(x)}</b><br/>` +
               `<span style="color:${col}">●</span> PnL: <b style="color:${col}">${fmtUsd(y)}</b>`;
      },
    },
    visualMap: {
      show: false,
      type: 'piecewise' as const,
      dimension: 1,
      seriesIndex: 0,
      pieces: [
        { gt: 0, color: '#28C840' },
        { lte: 0, color: '#FF5F57' },
      ],
    },
    series: [{
      type: 'line' as const, smooth: 0.15, showSymbol: false,
      data: lineData,
      lineStyle: { color: '#6366F1', width: 2 },
      areaStyle: {
        origin: 0,  // 以 y=0 作为基线，盈亏分色
        opacity: 0.85,
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0,   color: 'rgba(37,167,80,0.22)' },
            { offset: 0.5, color: 'rgba(37,167,80,0.04)' },
            { offset: 0.5, color: 'rgba(244,63,94,0.04)' },
            { offset: 1,   color: 'rgba(244,63,94,0.22)' },
          ],
        },
      },
      markLine: {
        symbol: 'none', silent: true,
        data: [
          { yAxis: 0, lineStyle: { color: 'rgba(255,255,255,0.16)', type: 'dashed' as const, width: 1 } },
          {
            xAxis: spot,
            lineStyle: { color: 'rgba(255,255,255,0.32)', type: 'dashed' as const, width: 1.4 },
            label: { formatter: `Spot $${fmtPx(spot)}`, color: 'rgba(255,255,255,0.5)', fontSize: 9, position: 'insideEndTop' as const },
          },
          ...breakevens.map((be, i) => ({
            xAxis: be,
            lineStyle: { color: 'rgba(251,191,36,0.55)', type: 'dashed' as const, width: 1 },
            label: { formatter: `BE${i + 1} ${fmtPx(be)}`, color: 'rgba(251,191,36,0.85)', fontSize: 8, position: 'insideEndBottom' as const },
          })),
        ],
      },
    }],
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      {/* Stats row */}
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[9px] text-slate-600">{livePositions.length} 个持仓</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-green)' }}>
          最大盈利 ${maxProfit >= 1000 ? (maxProfit / 1000).toFixed(1) + 'K' : maxProfit.toFixed(0)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--nexus-red)' }}>
          最大亏损 ${Math.abs(maxLoss) >= 1000 ? (maxLoss / 1000).toFixed(1) + 'K' : maxLoss.toFixed(0)}
        </span>
        {breakevens.map((be, i) => (
          <span key={i} className="text-[10px] font-mono text-slate-400">
            BE{i + 1} {be >= 10000 ? be.toLocaleString('en-US', { maximumFractionDigits: 0 }) : be.toFixed(1)}
          </span>
        ))}
      </div>
      {/* Chart */}
      <div className="flex-1 min-h-0">
        <EChart option={payoffOption} />
      </div>
    </div>
  );
});
export const VerticalSpreadPricerWidget = React.memo(({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata]         = useState<DeribitData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [spreadType, setSpreadType] = useState<SpreadType>('bull-call');
  const [expIdx, setExpIdx]       = useState(0);
  const [buyStrike, setBuyStrike] = useState<number | null>(null);
  const [sellStrike, setSellStrike] = useState<number | null>(null);

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

  // Reset strikes when expiry or type changes
  useEffect(() => { setBuyStrike(null); setSellStrike(null); }, [expIdx, spreadType]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const S = ddata.spot;
  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (!exps.length) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  const safeIdx = Math.min(expIdx, exps.length - 1);
  const exp = exps[safeIdx];
  const T   = Math.max(exp.daysToExp / 365, 0.001);

  // Available strikes
  const callStrikes: number[] = [...new Set<number>(exp.calls.map(c => c.strike))].sort((a, b) => a - b);
  const putStrikes:  number[] = [...new Set<number>(exp.puts.map(p => p.strike))].sort((a, b) => a - b);

  const buyStrikes  = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : callStrikes; // RR: buy call
  const sellStrikes = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : putStrikes; // RR: sell put

  const getIV = (strike: number, type: 'C' | 'P') => {
    const arr = type === 'C' ? exp.calls : exp.puts;
    return arr.find(o => o.strike === strike)?.iv ?? exp.atmIV / 100;
  };

  // Compute spread metrics when both strikes are selected
  let result: {
    buyPrice: number; sellPrice: number; net: number; maxProfit: number; maxLoss: number;
    beLower: number; beUpper: number | null;
    netDelta: number; netGamma: number; netVega: number; netTheta: number;
  } | null = null;

  if (buyStrike !== null && sellStrike !== null && buyStrike !== sellStrike) {
    const buyType:  'C' | 'P' = spreadType === 'bear-put' ? 'P' : 'C';
    const sellType: 'C' | 'P' = spreadType === 'risk-reversal' ? 'P' : buyType;

    const buyIV  = getIV(buyStrike,  buyType);
    const sellIV = getIV(sellStrike, sellType);

    const buyPrice  = (buyType  === 'C' ? bsCall : bsPut)(S, buyStrike,  T, buyIV);
    const sellPrice = (sellType === 'C' ? bsCall : bsPut)(S, sellStrike, T, sellIV);
    const net = buyPrice - sellPrice; // positive = debit, negative = credit

    let maxProfit = 0; let maxLoss = 0;
    let beLower = 0; let beUpper: number | null = null;

    if (spreadType === 'bull-call') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net; // at expiry, both ITM
      maxLoss   = net; // at expiry, both OTM
      beLower   = Math.min(buyStrike, sellStrike) + net;
    } else if (spreadType === 'bear-put') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net;
      maxLoss   = net;
      beLower   = Math.max(buyStrike, sellStrike) - net;
    } else { // risk reversal
      maxProfit = Infinity; // unlimited upside
      maxLoss   = -Infinity; // unlimited downside
      beLower   = buyStrike  + net; // call BE
      beUpper   = sellStrike - net; // put BE (if credit)
    }

    const netDelta = bsDelta(S, buyStrike, T, buyIV, buyType) - bsDelta(S, sellStrike, T, sellIV, sellType);
    const netGamma = bsGamma(S, buyStrike, T, buyIV) - bsGamma(S, sellStrike, T, sellIV);
    const netVega  = bsVega(S, buyStrike, T, buyIV) - bsVega(S, sellStrike, T, sellIV);
    const netTheta = bsTheta(S, buyStrike, T, buyIV) - bsTheta(S, sellStrike, T, sellIV);

    result = { buyPrice, sellPrice, net, maxProfit, maxLoss, beLower, beUpper, netDelta, netGamma, netVega, netTheta };
  }

  const spreadLabels: Record<SpreadType, string> = {
    'bull-call': '牛市价差（买低卖高 Call）',
    'bear-put':  '熊市价差（买高卖低 Put）',
    'risk-reversal': '风险逆转（买 Call 卖 Put）',
  };
  const buyLegLabel  = spreadType === 'bear-put' ? '买 Put' : '买 Call';
  const sellLegLabel = spreadType === 'risk-reversal' ? '卖 Put' : spreadType === 'bear-put' ? '卖 Put' : '卖 Call';

  const fmtUSD = (v: number) => `$${Math.abs(v) >= 1 ? v.toFixed(0) : v.toFixed(2)}`;

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Controls */}
      <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 shrink-0 flex-wrap border-b border-white/6">
        {(['bull-call', 'bear-put', 'risk-reversal'] as SpreadType[]).map(t => (
          <button key={t} onClick={() => setSpreadType(t)}
            className="px-2 py-0.5 rounded text-[10px] transition-colors"
            style={{
              background: spreadType === t ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              color: spreadType === t ? 'var(--nexus-accent)' : '#64748b',
              border: `1px solid ${spreadType === t ? 'rgba(99,102,241,0.4)' : 'transparent'}`,
            }}>{spreadLabels[t].split('（')[0]}</button>
        ))}
        <div className="h-4 w-px bg-white/8" />
        {exps.map((e, i) => (
          <button key={e.label} onClick={() => setExpIdx(i)}
            className="px-2 py-0.5 rounded text-[10px] font-mono transition-colors"
            style={{
              background: i === safeIdx ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: i === safeIdx ? '#e2e8f0' : '#475569',
            }}>{e.label}</button>
        ))}
      </div>

      {/* Strike selectors */}
      <div className="flex items-center gap-3 px-3 py-1.5 shrink-0 border-b border-white/6">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 w-[44px]">{buyLegLabel}</span>
          <select value={buyStrike ?? ''} onChange={e => setBuyStrike(Number(e.target.value))}
            className="text-[10px] font-mono bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-slate-300 outline-none">
            <option value="">选择行权价</option>
            {buyStrikes.map(k => <option key={k} value={k}>{k.toLocaleString()}{k === (buyStrikes as number[]).reduce((b: number, s: number) => Math.abs(s - S) < Math.abs(b - S) ? s : b, buyStrikes[0]) ? ' ★' : ''}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-500 w-[44px]">{sellLegLabel}</span>
          <select value={sellStrike ?? ''} onChange={e => setSellStrike(Number(e.target.value))}
            className="text-[10px] font-mono bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-slate-300 outline-none">
            <option value="">选择行权价</option>
            {sellStrikes.map(k => <option key={k} value={k}>{k.toLocaleString()}{k === (sellStrikes as number[]).reduce((b: number, s: number) => Math.abs(s - S) < Math.abs(b - S) ? s : b, sellStrikes[0]) ? ' ★' : ''}</option>)}
          </select>
        </div>
        <span className="text-[9px] text-slate-600 ml-auto">★ = 最近ATM</span>
      </div>

      {/* Results */}
      {!result ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          选择买腿和卖腿行权价
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2 flex flex-col gap-2">
          {/* Cost & payoff */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: result.net >= 0 ? '净付权利金' : '净收权利金', val: fmtUSD(result.net), color: result.net >= 0 ? 'var(--nexus-red)' : 'var(--nexus-green)' },
              { label: '最大盈利', val: isFinite(result.maxProfit) ? fmtUSD(result.maxProfit) : '无限', color: 'var(--nexus-green)' },
              { label: '最大亏损', val: isFinite(result.maxLoss) ? fmtUSD(-result.maxLoss) : '无限', color: 'var(--nexus-red)' },
            ].map(s => (
              <div key={s.label} className="flex flex-col items-center py-1.5 rounded-lg bg-white/3 border border-white/6">
                <span className="text-[8px] text-slate-600 uppercase tracking-wider">{s.label}</span>
                <span className="text-[15px] font-mono font-bold tnum mt-0.5" style={{ color: s.color }}>{s.val}</span>
              </div>
            ))}
          </div>
          {/* Breakevens + Greeks */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 px-2 py-1.5 rounded-lg bg-white/3 border border-white/6">
              <span className="text-[8px] text-slate-600 uppercase tracking-wider">盈亏平衡</span>
              <span className="text-[11px] font-mono text-slate-200">
                {result.beLower.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                {result.beUpper !== null && ` / ${result.beUpper.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 px-2 py-1.5 rounded-lg bg-white/3 border border-white/6">
              {[
                { label: 'Δ', val: result.netDelta.toFixed(3) },
                { label: 'Γ', val: result.netGamma.toFixed(5) },
                { label: 'ν/1%', val: `$${(result.netVega * S).toFixed(0)}` },
                { label: 'Θ/d', val: `$${(result.netTheta * S).toFixed(0)}` },
              ].map(g => (
                <div key={g.label} className="flex flex-col items-center">
                  <span className="text-[8px] text-slate-600">{g.label}</span>
                  <span className="text-[10px] font-mono text-slate-300">{g.val}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Leg detail */}
          <div className="flex gap-2">
            {[
              { label: buyLegLabel, strike: buyStrike!, price: result.buyPrice, color: 'var(--nexus-green)' },
              { label: sellLegLabel, strike: sellStrike!, price: result.sellPrice, color: 'var(--nexus-red)' },
            ].map(leg => (
              <div key={leg.label} className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/3 border border-white/6">
                <span className="text-[9px] font-bold" style={{ color: leg.color }}>{leg.label}</span>
                <span className="text-[10px] font-mono text-slate-300">{leg.strike.toLocaleString()}</span>
                <span className="text-[10px] font-mono text-slate-400">{fmtUSD(leg.price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
