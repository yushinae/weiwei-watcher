import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { mapPts, poly, smooth, area } from '../lib/svg-utils';
import type { DeribitData, HistoryData, ExpiryGroup, ParsedOption } from './types';
import { useDeribitOptions, useDeribitHistory } from './data-hooks';
import { subscribeData, fetchDeribitOptions, CACHE_TTL } from './data-layer';
import {
  GRID, TXT, BRAND, YELLOW, BLUE,
  CoinControlProps, useCoinControl, WidgetShell, CoinTabs, LiveBadge, Skeleton,
  pickExpiries, ivrColor, ivrLabel, pcrColor, pcrLabel,
} from './ui-helpers';
import {
  BTC_POLY, ETH_POLY, VOL,
} from '../features/monitor/data/mock';

// ═══════════════════════════════════════════════════════════════════════════════
// Block Trade types & fetching
// ═══════════════════════════════════════════════════════════════════════════════

interface BlockTrade {
  tradeId: string;
  instrument: string;
  direction: 'buy' | 'sell';
  amount: number;
  price: number;
  iv: number;
  indexPrice: number;
  ts: number;
  strike: number;
  expiry: string;
  optType: 'C' | 'P';
  notionalUSD: number;
  premiumUSD: number;
}

const BT_SEEN  = new Map<string, Set<string>>();
const BT_STATE = new Map<string, BlockTrade[]>();
const BT_TTL = 5_000;
const BT_MIN_USD = 50_000;

async function fetchBlockTrades(currency: 'BTC' | 'ETH'): Promise<BlockTrade[]> {
  const resp = await fetch(
    `https://www.deribit.com/api/v2/public/get_last_trades_by_currency?currency=${currency}&kind=option&count=100`
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  const rawTrades: any[] = json?.result?.trades ?? [];

  const seen = BT_SEEN.get(currency) ?? new Set<string>();
  const existing = BT_STATE.get(currency) ?? [];
  const newTrades: BlockTrade[] = [];

  for (const t of rawTrades) {
    if (seen.has(t.trade_id)) continue;
    const parts = (t.instrument_name as string).split('-');
    if (parts.length < 4) continue;
    const strike = parseInt(parts[2]);
    const optType = parts[3] as 'C' | 'P';
    const indexPrice: number = t.index_price ?? t.underlying_price ?? 0;
    const amount: number = t.amount ?? 0;
    const price: number = t.price ?? 0;
    const notionalUSD = amount * indexPrice;
    if (notionalUSD < BT_MIN_USD) continue;

    seen.add(t.trade_id);
    newTrades.push({
      tradeId: t.trade_id,
      instrument: t.instrument_name,
      direction: t.direction as 'buy' | 'sell',
      amount,
      price,
      iv: t.iv ?? t.mark_iv ?? 0,
      indexPrice,
      ts: t.timestamp,
      strike,
      expiry: parts[1],
      optType,
      notionalUSD,
      premiumUSD: amount * price * indexPrice,
    });
  }

  if (seen.size > 2000) {
    const arr = [...seen];
    arr.slice(0, arr.length - 1000).forEach(id => seen.delete(id));
  }
  BT_SEEN.set(currency, seen);

  const merged = [...newTrades, ...existing].slice(0, 120);
  BT_STATE.set(currency, merged);
  return merged;
}

function useBlockTrades(coin: Coin) {
  const [trades, setTrades] = useState<BlockTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const currency = coin === 'BTC' ? 'BTC' : 'ETH';

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<BlockTrade[]>(
      `blocktrades-${currency}`,
      () => fetchBlockTrades(currency),
      BT_TTL,
      d => { if (active) { setTrades([...d]); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, [currency]);

  return { trades, loading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FlowData types (needed by IVSignal & Sentiment widgets)
// ═══════════════════════════════════════════════════════════════════════════════

interface FundingPoint { ts: number; rate: number; }

interface BasisPoint { label: string; daysToExp: number; annBasis: number; spot: number; futurePx: number; }

interface FearGreedPoint { value: number; label: string; ts: number; }

export interface FlowData {
  fundingHistory: FundingPoint[];
  currentFunding8h: number;
  annFunding: number;
  basis: BasisPoint[];
  fearGreed: FearGreedPoint[];
  currentFG: number;
  currentFGLabel: string;
  fetchedAt: number;
}

const FLOW_CACHE = new Map<string, { data: FlowData; ts: number }>();
const FLOW_TTL = 60_000;

const MONTH_MAP_FUTURES: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseFuturesExpiry(instrName: string): number | null {
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

  let fundingHistory: FundingPoint[] = [];
  let currentFunding8h = 0;
  let annFunding = 0;
  if (fundingResp.status === 'fulfilled') {
    const json = await fundingResp.value.json().catch(() => null);
    const raw: Array<{ timestamp: number; interest: number }> = json?.result ?? [];
    fundingHistory = raw.map(r => ({ ts: r.timestamp, rate: r.interest * 100 }));
    if (fundingHistory.length) {
      currentFunding8h = fundingHistory[fundingHistory.length - 1].rate;
      annFunding = currentFunding8h * 3 * 365;
    }
  }

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

  let fearGreed: FearGreedPoint[] = [];
  let currentFG = 50;
  let currentFGLabel = 'Neutral';
  if (fgResp.status === 'fulfilled') {
    const json = await fgResp.value.json().catch(() => null);
    const raw: Array<{ value: string; value_classification: string; timestamp: string }> = json?.data ?? [];
    fearGreed = raw
      .map(d => ({ value: parseInt(d.value), label: d.value_classification, ts: parseInt(d.timestamp) * 1000 }))
      .reverse();
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

export function useFlowData(coin: Coin) {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const currency = coin === 'BTC' ? 'BTC' : 'ETH';

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      `flow-${currency}`,
      () => fetchFlowData(currency),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, [currency]);

  return { data, loading };
}

function useFearGreed() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      'flow-BTC',
      () => fetchFlowData('BTC'),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, []);
  return { data, loading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TickerSnapshot
// ═══════════════════════════════════════════════════════════════════════════════

interface TickerSnapshot {
  spot: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  dvol: number;
  fundingAnn: number;
  optOI_M: number;
  optVol24h_M: number;
}
const TICKER_CACHE2 = new Map<string, { data: TickerSnapshot; ts: number }>();
const TICKER_TTL2 = 8_000;

async function fetchTickerSnapshot(coin: Coin): Promise<TickerSnapshot> {
  const key = coin;
  const hit = TICKER_CACHE2.get(key);
  if (hit && Date.now() - hit.ts < TICKER_TTL2) return hit.data;

  const cur = coin === 'BTC' ? 'BTC' : 'ETH';
  const idx = coin === 'BTC' ? 'btc_usd' : 'eth_usd';

  const [spotRes, perpRes, optRes, optChain] = await Promise.all([
    fetch(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${idx}`).then(r => r.json()),
    fetch(`https://www.deribit.com/api/v2/public/ticker?instrument_name=${cur}-PERPETUAL`).then(r => r.json()),
    fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${cur}&kind=option`).then(r => r.json()),
    fetchDeribitOptions(coin).catch(() => null),
  ]);

  const spot: number = spotRes.result?.index_price ?? 0;
  const perp = perpRes.result ?? {};
  const stats = perp.stats ?? {};
  const high24h: number = stats.high ?? spot * 1.01;
  const low24h: number = stats.low ?? spot * 0.99;
  const change24hPct: number = stats.price_change ?? 0;
  const funding8h: number = perp.current_funding ?? 0;
  const fundingAnn: number = funding8h * 3 * 365 * 100;

  const books: any[] = optRes.result ?? [];
  const optOI = books.reduce((s: number, b: any) => s + (b.open_interest ?? 0), 0);
  const optVol24h = books.reduce((s: number, b: any) => s + (b.volume_usd ?? 0), 0);

  const dvol: number = optChain?.dvol30 ?? 0;

  const data: TickerSnapshot = {
    spot,
    change24hPct,
    high24h,
    low24h,
    dvol,
    fundingAnn,
    optOI_M: (optOI * spot) / 1e6,
    optVol24h_M: optVol24h / 1e6,
  };
  TICKER_CACHE2.set(key, { data, ts: Date.now() });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orderbook
// ═══════════════════════════════════════════════════════════════════════════════

const OB_CACHE     = new Map<string, { data: any; ts: number }>();
const OB_FETCH_TTL = 3_000;

async function fetchOrderbook(coin: Coin): Promise<{ bids: [number, number][]; asks: [number, number][]; mark: number; spread: number }> {
  const key = coin;
  const hit = OB_CACHE.get(key);
  if (hit && Date.now() - hit.ts < OB_FETCH_TTL) return hit.data;

  const inst = coin === 'BTC' ? 'BTC-PERPETUAL' : 'ETH-PERPETUAL';
  const res = await fetch(
    `https://www.deribit.com/api/v2/public/get_order_book?instrument_name=${inst}&depth=20`
  ).then(r => r.json());

  const r = res.result ?? {};
  const bids: [number, number][] = (r.bids ?? []).slice(0, 15);
  const asks: [number, number][] = (r.asks ?? []).slice(0, 15);
  const mark   = r.mark_price ?? 0;
  const spread = r.ask_price - r.bid_price || 0;
  const data = { bids, asks, mark, spread };
  OB_CACHE.set(key, { data, ts: Date.now() });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Alerts
// ═══════════════════════════════════════════════════════════════════════════════

type AlertMetric = 'spot' | 'dvol' | 'ivrank' | 'funding' | 'sentiment' | 'callflow' | 'putflow';
type AlertOp     = '>' | '<';

interface UserAlert {
  id: string; coin: Coin; metric: AlertMetric; op: AlertOp;
  threshold: number; active: boolean;
  triggered: boolean; lastValue: number | null; triggeredAt: number | null;
}
const ALERTS_STORE: UserAlert[] = [];

const METRIC_META: Record<AlertMetric, { label: string; unit: string; defaultVal: number }> = {
  spot:      { label: 'Spot 价格',    unit: '$',    defaultVal: 90000 },
  dvol:      { label: 'DVOL',         unit: '%',    defaultVal: 60    },
  ivrank:    { label: 'IV 百分位',    unit: '%ile', defaultVal: 80    },
  funding:   { label: '年化资金费率', unit: '%',    defaultVal: 50    },
  sentiment: { label: '情绪评分',     unit: 'pts',  defaultVal: 30    },
  callflow:  { label: 'Call 净流向',  unit: 'K$',   defaultVal: 1000  },
  putflow:   { label: 'Put 净流向',   unit: 'K$',   defaultVal: -500  },
};

// Need DERIBIT_CACHE, HIST_CACHE, FLOW_CACHE, TICKER_CACHE2, PFLOW_ACC access
// These are imported from their modules. We access the caches through the module scope.
// For evalAlerts, we need access to caches. Since these are in different modules,
// we use the exported module-level variables.
import { DERIBIT_CACHE, HIST_CACHE } from './data-layer';
const PFLOW_ACC_MARKET = new Map<string, { cumCallNet: number; cumPutNet: number }>();

function evalAlerts(coin: Coin): void {
  const optC  = DERIBIT_CACHE.get(coin);
  const histC = HIST_CACHE.get(coin);
  const flowC = FLOW_CACHE.get(coin);
  const tickC = TICKER_CACHE2.get(coin);
  const pflAc = PFLOW_ACC_MARKET.get(coin);

  const vals: Partial<Record<AlertMetric, number>> = {};
  if (tickC)  { vals.spot = tickC.data.spot; vals.dvol = tickC.data.dvol; }
  else if (optC) { vals.spot = optC.data.spot; }
  if (histC)  vals.ivrank = histC.data.ivRankCurrent;
  if (flowC)  vals.funding = flowC.data.annFunding;
  if (pflAc)  { vals.callflow = pflAc.cumCallNet / 1000; vals.putflow = pflAc.cumPutNet / 1000; }

  for (const a of ALERTS_STORE) {
    if (!a.active || a.coin !== coin) continue;
    const v = vals[a.metric];
    if (v === undefined) continue;
    a.lastValue = v;
    const prev = a.triggered;
    a.triggered = a.op === '>' ? v > a.threshold : v < a.threshold;
    if (a.triggered && !prev) a.triggeredAt = Date.now();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VOLOVERVIEW WIDGET
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

  const dvol      = data?.dvol30              ?? mock.dvol;
  const dvolChg   = histData?.dvolChange24h   ?? mock.dvolChange;
  const pcr       = data?.pcr                 ?? mock.pcr;
  const ivRank    = histData?.ivRankCurrent   ?? mock.ivRank;
  const iv30      = data?.dvol30              ?? mock.iv30;

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
        <div className="grid grid-cols-3 divide-x divide-surface-2/80">
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
          <div className="px-3 py-2">
            <div className="flex items-center gap-1 mb-1">
              <div className="text-[9px] font-bold text-slate-600 tracking-wider uppercase">PCR</div>
              {data && <LiveBadge />}
            </div>
            <div className="text-[16px] font-mono font-bold tnum leading-none mb-0.5" style={{ color: pcrc }}>{pcr.toFixed(2)}</div>
            <div className="text-[9px] font-mono" style={{ color: pcrc }}>{pcrLabel(pcr)}</div>
          </div>
        </div>
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
// IV SIGNAL WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

type SignalSeverity = 'bullish' | 'bearish' | 'warning' | 'neutral';

interface IVSignal {
  id: string;
  label: string;
  value: string;
  desc: string;
  severity: SignalSeverity;
}

function severityColor(s: SignalSeverity): string {
  if (s === 'bullish')  return '#25e889';
  if (s === 'bearish')  return '#f87171';
  if (s === 'warning')  return '#F59E0B';
  return 'rgba(255,255,255,0.35)';
}
function severityBg(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.08)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.08)';
  if (s === 'warning')  return 'rgba(245,158,11,0.08)';
  return 'rgba(255,255,255,0.03)';
}
function severityBorder(s: SignalSeverity): string {
  if (s === 'bullish')  return 'rgba(37,232,137,0.18)';
  if (s === 'bearish')  return 'rgba(248,113,113,0.18)';
  if (s === 'warning')  return 'rgba(245,158,11,0.18)';
  return 'rgba(255,255,255,0.07)';
}

function generateSignals(
  data: DeribitData,
  histData: HistoryData | null,
  flowData: FlowData | null,
): IVSignal[] {
  const signals: IVSignal[] = [];

  const ivr = histData?.ivRankCurrent ?? null;
  if (ivr !== null) {
    signals.push({
      id: 'ivrank',
      label: 'IV Rank',
      value: `${ivr.toFixed(0)}%`,
      desc: ivr >= 80 ? '极端高位 — 卖方溢价，考虑卖 IV'
          : ivr >= 60 ? '偏高 — IV 较贵，中性策略占优'
          : ivr <= 20 ? '极端低位 — IV 便宜，考虑买 IV'
          : ivr <= 40 ? '偏低 — IV 较便宜，长 vega 策略有优势'
          : '中性区间',
      severity: ivr >= 75 ? 'bearish' : ivr <= 25 ? 'bullish' : ivr >= 60 ? 'warning' : 'neutral',
    });
  }

  const pcr = data.pcr;
  signals.push({
    id: 'pcr',
    label: 'PCR（OI）',
    value: pcr.toFixed(2),
    desc: pcr >= 1.2 ? '看跌 OI 严重堆积 — 市场偏悲观'
        : pcr >= 1.0 ? '看跌稍多 — 轻度偏空情绪'
        : pcr <= 0.6 ? '看涨 OI 过多 — 市场过度乐观'
        : pcr <= 0.8 ? '看涨偏向 — 多头情绪略占优'
        : '多空均衡',
    severity: pcr >= 1.2 ? 'bearish' : pcr <= 0.6 ? 'warning' : pcr >= 1.0 ? 'warning' : 'neutral',
  });

  const exp30 = data.expiries.length
    ? data.expiries.reduce((best, e) =>
        Math.abs(e.daysToExp - 30) < Math.abs(best.daysToExp - 30) ? e : best,
        data.expiries[0])
    : null;
  if (exp30) {
    const rr25 = exp30.rr25;
    signals.push({
      id: 'skew',
      label: '30D Skew (RR25)',
      value: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(2)}%`,
      desc: rr25 <= -5 ? '强烈看跌偏斜 — 市场积极买入保护'
          : rr25 <= -2 ? '温和看跌偏斜 — 下行保护溢价'
          : rr25 >= 5  ? '强烈看涨偏斜 — 上行 Call 需求旺盛'
          : rr25 >= 2  ? '温和看涨偏斜'
          : '偏斜基本中性',
      severity: rr25 <= -5 ? 'bearish' : rr25 >= 5 ? 'bullish' : rr25 <= -2 ? 'warning' : 'neutral',
    });
  }

  if (histData) {
    const vrpPairs = histData.vrp;
    if (vrpPairs.length) {
      const latest = vrpPairs[vrpPairs.length - 1];
      const vrp = latest.iv - latest.rv;
      signals.push({
        id: 'vrp',
        label: 'VRP (IV−RV)',
        value: `${vrp >= 0 ? '+' : ''}${vrp.toFixed(1)}pp`,
        desc: vrp >= 12 ? '波动率风险溢价极高 — 卖方历史上有稳定收益'
            : vrp >= 6  ? 'VRP 偏高 — 期权定价偏贵'
            : vrp <= 0  ? 'VRP 为负 — 已实现波动超过隐含波动，少见'
            : vrp <= 2  ? 'VRP 受压 — 期权相对便宜'
            : 'VRP 正常区间',
        severity: vrp >= 12 ? 'bearish' : vrp <= 0 ? 'bullish' : vrp <= 2 ? 'warning' : 'neutral',
      });
    }
  }

  if (flowData) {
    const annFunding = flowData.annFunding;
    signals.push({
      id: 'funding',
      label: '资金费率（年化）',
      value: `${annFunding >= 0 ? '+' : ''}${annFunding.toFixed(1)}%`,
      desc: annFunding >= 50 ? '永续多头极度拥挤 — 回调风险高'
          : annFunding >= 25 ? '资金费率偏高 — 多头主导，注意过热'
          : annFunding <= -15? '永续空头拥挤 — 轧空风险'
          : annFunding <= -5 ? '资金费率偏低 — 市场偏空情绪'
          : '资金费率中性',
      severity: annFunding >= 50 ? 'bearish' : annFunding <= -15 ? 'bullish'
              : annFunding >= 25 ? 'warning' : annFunding <= -5 ? 'warning' : 'neutral',
    });
  }

  if (data.expiries.length >= 2) {
    const front = data.expiries[0];
    const back  = data.expiries[data.expiries.length - 1];
    const slope = back.atmIV - front.atmIV;
    signals.push({
      id: 'termstructure',
      label: '期限结构',
      value: `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}pp`,
      desc: slope <= -8 ? '强倒挂 — 近端 IV 极度拥挤，事件驱动风险高'
          : slope <= -3 ? '轻度倒挂 — 近端 IV 抬升，市场情绪偏紧张'
          : slope >= 8  ? '显著正斜 — 远端溢价高，日历价差受益'
          : slope >= 3  ? '正常正斜 — 结构健康'
          : '平坦期限结构',
      severity: slope <= -8 ? 'bearish' : slope <= -3 ? 'warning'
              : slope >= 8  ? 'bullish' : 'neutral',
    });
  }

  return signals;
}

export const IVSignalWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading }    = useDeribitOptions(coin);
  const { data: histData }   = useDeribitHistory(coin);
  const { data: flowData }   = useFlowData(coin);
  const { setHeaderRight }   = useCardHeader();

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
            <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/30 truncate">{sig.label}</span>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: severityColor(sig.severity), boxShadow: `0 0 5px ${severityColor(sig.severity)}88` }}
            />
          </div>
          <div className="font-mono text-[15px] font-bold leading-none mb-1.5" style={{ color: severityColor(sig.severity) }}>
            {sig.value}
          </div>
          <div className="text-[9px] text-white/30 leading-snug line-clamp-2">{sig.desc}</div>
        </div>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE OPTIONS CHAIN WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const LiveOptionsChainWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  const [selectedExp, setSelectedExp] = useState<number>(0);

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

  const callsByStrike = new Map<number, typeof exp.calls[0]>();
  const putsByStrike  = new Map<number, typeof exp.puts[0]>();
  exp.calls.forEach(o => callsByStrike.set(o.strike, o));
  exp.puts.forEach(o => putsByStrike.set(o.strike, o));

  const allStrikes = [...new Set([...callsByStrike.keys(), ...putsByStrike.keys()])]
    .filter(k => k >= spot * 0.75 && k <= spot * 1.25)
    .sort((a, b) => b - a);

  const atmStrike = allStrikes.reduce(
    (best, k) => Math.abs(k - spot) < Math.abs(best - spot) ? k : best,
    allStrikes[0] ?? spot,
  );

  const fmt = (v: number) => v > 0 ? v.toFixed(1) : '—';
  const fmtOI = (v: number) => v > 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
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
                  <td className={cn('text-right px-2 py-1.5 font-mono tnum', aboveSpot ? 'text-white/30' : 'text-emerald-400/80')}>
                    {call ? fmt(call.iv) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/40">
                    {call ? call.delta.toFixed(2) : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono tnum text-white/35">
                    {call ? fmtOI(call.oi) : '—'}
                  </td>
                  <td className={cn(
                    'text-center px-3 py-1.5 font-mono font-bold bg-white/[0.03]',
                    isAtm ? 'text-[var(--nexus-accent)]' : 'text-white/70',
                  )}>
                    {strike.toLocaleString()}
                    {isAtm && <span className="ml-1 text-[8px] text-[var(--nexus-accent)]/60">ATM</span>}
                  </td>
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
// IMPLIED MOVE WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const ImpliedMoveWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const exps = data.expiries.slice(0, 8);
  const SQRT_2_PI = Math.sqrt(2 / Math.PI);

  const rows = exps.map(e => {
    const movePct = (e.atmIV / 100) * Math.sqrt(e.T) * SQRT_2_PI * 100;
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
        const urgency = r.daysToExp <= 7 ? '#F59E0B' : r.daysToExp <= 30 ? '#25e889' : '#4ea1ff';
        return (
          <div key={r.label}
            className="flex-1 min-w-[96px] flex flex-col justify-between bg-white/[0.025] border border-white/[0.06] rounded-[10px] px-2.5 py-2 shrink-0"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] font-bold" style={{ color: urgency }}>{r.label}</span>
              <span className="text-[9px] text-white/25 font-mono">{r.atmIV.toFixed(1)}%</span>
            </div>
            <div className="font-mono text-[17px] font-bold leading-none mb-1" style={{ color: urgency }}>
              ±{r.movePct.toFixed(1)}%
            </div>
            <div className="flex justify-between text-[8.5px] font-mono mb-1.5">
              <span style={{ color: '#25e889' }}>↑${fmtPx(r.upTarget)}</span>
              <span style={{ color: '#f87171' }}>↓${fmtPx(r.downTarget)}</span>
            </div>
            <div className="h-[3px] rounded-full overflow-hidden bg-white/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${barFill}%`, background: urgency, opacity: 0.7 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SPOT TICKER WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const SpotTickerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [snap, setSnap] = useState<TickerSnapshot | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevSpotRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    prevSpotRef.current = undefined;
    const unsub = subscribeData<TickerSnapshot>(
      `ticker-${coin}`,
      () => fetchTickerSnapshot(coin),
      TICKER_TTL2,
      d => {
        if (!alive) return;
        if (prevSpotRef.current !== undefined && d.spot !== prevSpotRef.current) {
          setFlash(d.spot > prevSpotRef.current ? 'up' : 'down');
          setTimeout(() => setFlash(null), 500);
        }
        prevSpotRef.current = d.spot;
        setSnap(d);
      },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (!snap) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>
  );

  const fmtPrice = (p: number) =>
    p >= 10000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(2);

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
};

// ═══════════════════════════════════════════════════════════════════════════════
// SENTIMENT COMPOSITE WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

interface SentFactor { label: string; score: number; raw: string; weight: number }

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

async function computeSentiment(coin: Coin): Promise<{ composite: number; factors: SentFactor[] }> {
  const [opt, hist, flow] = await Promise.all([
    fetchDeribitOptions(coin),
    (await import('./data-layer')).fetchDeribitHistory(coin),
    fetchFlowData(coin),
  ]);

  const pcrScore   = clamp01((2.0 - opt.pcr) / 1.5);
  const rr25 = opt.expiries.find(e => e.daysToExp >= 1)?.rr25 ?? 0;
  const skewScore  = clamp01((rr25 + 10) / 20);
  const ivrScore   = clamp01(1 - hist.ivRankCurrent / 100);
  const fundScore  = clamp01((flow.annFunding + 100) / 200);
  const fgScore    = clamp01(flow.currentFG / 100);
  const dvolScore  = clamp01((-hist.dvolChange24h + 10) / 20);

  const factors: SentFactor[] = [
    { label: 'PCR',      score: pcrScore  * 100, raw: opt.pcr.toFixed(2),            weight: 2 },
    { label: 'Skew 25δ', score: skewScore * 100, raw: `${rr25 >= 0 ? '+' : ''}${rr25.toFixed(1)}vp`, weight: 2 },
    { label: 'IV Rank',  score: ivrScore  * 100, raw: `${hist.ivRankCurrent.toFixed(0)}%ile`,  weight: 1.5 },
    { label: '资金费率',  score: fundScore * 100, raw: `${flow.annFunding >= 0 ? '+' : ''}${flow.annFunding.toFixed(1)}%`, weight: 1.5 },
    { label: 'FG指数',   score: fgScore   * 100, raw: `${flow.currentFG} ${flow.currentFGLabel}`, weight: 1 },
    { label: 'DVOL Δ',   score: dvolScore * 100, raw: `${hist.dvolChange24h >= 0 ? '+' : ''}${hist.dvolChange24h.toFixed(1)}%`, weight: 1 },
  ];

  const totalW  = factors.reduce((s, f) => s + f.weight, 0);
  const composite = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalW;
  return { composite, factors };
}

export const SentimentCompositeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [result, setResult] = useState<{ composite: number; factors: SentFactor[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<{ composite: number; factors: SentFactor[] }>(
      `sentiment-${coin}`,
      () => computeSentiment(coin),
      30_000,
      r => { if (alive) { setResult(r); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (loading || !result) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const { composite, factors } = result;
  const label  = composite >= 70 ? '极度乐观' : composite >= 55 ? '偏多'   : composite >= 45 ? '中性' : composite >= 30 ? '偏空' : '极度悲观';
  const color  = composite >= 70 ? '#25a750'  : composite >= 55 ? '#86efac' : composite >= 45 ? '#94a3b8' : composite >= 30 ? '#fca5a5' : '#f43f5e';

  const R = 56; const CX = 80; const CY = 72;
  const toRad = (deg: number) => (deg - 180) * Math.PI / 180;
  const arcX  = (deg: number) => CX + R * Math.cos(toRad(deg));
  const arcY  = (deg: number) => CY + R * Math.sin(toRad(deg));
  const pctDeg = composite / 100 * 180;
  const needleAngle = pctDeg;

  const trackPath = `M ${arcX(0)} ${arcY(0)} A ${R} ${R} 0 0 1 ${arcX(180)} ${arcY(180)}`;
  const fillPath  = pctDeg > 0
    ? `M ${arcX(0)} ${arcY(0)} A ${R} ${R} 0 ${pctDeg > 90 ? 1 : 0} 1 ${arcX(pctDeg)} ${arcY(pctDeg)}`
    : '';
  const nx = CX + (R - 6) * Math.cos(toRad(needleAngle));
  const ny = CY + (R - 6) * Math.sin(toRad(needleAngle));

  const factorColor = (s: number) =>
    s >= 65 ? '#25a750' : s >= 45 ? '#94a3b8' : '#f43f5e';

  return (
    <div className="w-full h-full flex items-center gap-6 px-4">
      <div className="shrink-0 flex flex-col items-center" style={{ width: 160 }}>
        <svg viewBox="0 0 160 90" width="160" height="90">
          <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
          {fillPath && (
            <path d={fillPath} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color}80)` }} />
          )}
          <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="4" fill={color} />
          <text x="18" y="86" fill="#64748b" fontSize="8" textAnchor="middle">熊</text>
          <text x="142" y="86" fill="#64748b" fontSize="8" textAnchor="middle">牛</text>
          <text x={CX} y={CY - 10} fill={color} fontSize="20" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
            {composite.toFixed(0)}
          </text>
          <text x={CX} y={CY + 4} fill={color} fontSize="9" textAnchor="middle">{label}</text>
        </svg>
      </div>

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
            <div className="w-[32px] h-[4px] rounded-full overflow-hidden bg-white/6 shrink-0">
              <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: factorColor(f.score) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERBOOK DEPTH WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const OrderbookDepthWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ob, setOb] = useState<{ bids: [number, number][]; asks: [number, number][]; mark: number; spread: number } | null>(null);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    const unsub = subscribeData(
      `orderbook-${coin}`,
      () => fetchOrderbook(coin),
      OB_FETCH_TTL,
      (d: { bids: [number, number][]; asks: [number, number][]; mark: number; spread: number }) => {
        if (alive) setOb(d);
      },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  if (!ob) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const ROWS = Math.min(ob.bids.length, ob.asks.length, 12);
  let cumBid = 0; let cumAsk = 0;
  const bidRows = ob.bids.slice(0, ROWS).map(([p, s]) => { cumBid += s; return { p, s, cum: cumBid }; });
  const askRows = ob.asks.slice(0, ROWS).map(([p, s]) => { cumAsk += s; return { p, s, cum: cumAsk }; });
  const maxCum = Math.max(cumBid, cumAsk, 1);
  const fmtPrice = (p: number) => p >= 10000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p.toFixed(2);
  const fmtSize  = (s: number) => s >= 1000 ? `${(s / 1000).toFixed(1)}K` : s.toFixed(1);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 shrink-0 border-b border-white/6">
        <span className="text-[10px] font-mono text-slate-400">
          Mark <span className="text-slate-200 font-bold">{fmtPrice(ob.mark)}</span>
        </span>
        <span className="text-[9px] font-mono text-slate-500">
          Spread {fmtPrice(ob.spread)} ({ob.mark > 0 ? (ob.spread / ob.mark * 100).toFixed(3) : '—'}%)
        </span>
      </div>
      <div className="grid px-3 py-0.5 shrink-0" style={{ gridTemplateColumns: '1fr 60px 8px 60px 1fr' }}>
        <span className="text-[8px] text-slate-600 text-left">深度</span>
        <span className="text-[8px] text-slate-600 text-right">买价</span>
        <span />
        <span className="text-[8px] text-slate-600 text-left">卖价</span>
        <span className="text-[8px] text-slate-600 text-right">深度</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-start px-3 pb-1 gap-[1px]">
        {Array.from({ length: ROWS }, (_, i) => {
          const bid = bidRows[i]; const ask = askRows[i];
          const bBarW = bid ? (bid.cum / maxCum) * 100 : 0;
          const aBarW = ask ? (ask.cum / maxCum) * 100 : 0;
          return (
            <div key={i} className="grid items-center" style={{ gridTemplateColumns: '1fr 60px 8px 60px 1fr', height: 18 }}>
              <div className="relative h-[10px] rounded-sm overflow-hidden bg-transparent">
                <div className="absolute right-0 top-0 h-full rounded-sm"
                  style={{ width: `${bBarW}%`, background: 'rgba(37,167,80,0.25)' }} />
                {bid && <span className="absolute left-0 text-[8px] font-mono text-slate-600">{fmtSize(bid.s)}</span>}
              </div>
              {bid
                ? <span className="text-[10px] font-mono font-bold tnum text-right" style={{ color: 'var(--nexus-green)' }}>{fmtPrice(bid.p)}</span>
                : <span />}
              <span />
              {ask
                ? <span className="text-[10px] font-mono font-bold tnum text-left" style={{ color: 'var(--nexus-red)' }}>{fmtPrice(ask.p)}</span>
                : <span />}
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
};

// ═══════════════════════════════════════════════════════════════════════════════
// ALERTS WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const AlertsWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [alerts, setAlerts] = useState<UserAlert[]>([...ALERTS_STORE]);
  const [metric, setMetric] = useState<AlertMetric>('spot');
  const [op, setOp]         = useState<AlertOp>('>');
  const [thresh, setThresh] = useState('');

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  useEffect(() => {
    let alive = true;
    const tick = () => { evalAlerts(coin); if (alive) setAlerts([...ALERTS_STORE]); };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [coin]);

  const addAlert = () => {
    const t = parseFloat(thresh);
    if (isNaN(t)) return;
    ALERTS_STORE.push({
      id: `${Date.now()}`, coin, metric, op, threshold: t,
      active: true, triggered: false, lastValue: null, triggeredAt: null,
    });
    setAlerts([...ALERTS_STORE]);
    setThresh('');
  };

  const removeAlert = (id: string) => {
    const i = ALERTS_STORE.findIndex(a => a.id === id);
    if (i >= 0) ALERTS_STORE.splice(i, 1);
    setAlerts([...ALERTS_STORE]);
  };

  const toggleAlert = (id: string) => {
    const a = ALERTS_STORE.find(x => x.id === id);
    if (a) { a.active = !a.active; a.triggered = false; }
    setAlerts([...ALERTS_STORE]);
  };

  const meta = METRIC_META[metric];

  return (
    <div className="w-full h-full flex flex-col min-h-0">
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
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.active ? (a.triggered ? ringColor : 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.06)' }} />
                <span className="flex-1 text-[10px] font-mono text-slate-300">
                  {m.label} {a.op} <span className="font-bold text-slate-100">{fmtVal(a.threshold)}</span> {m.unit}
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  现值 <span style={{ color: a.triggered ? ringColor : '#94a3b8' }}>{fmtVal(a.lastValue)}</span>
                </span>
                {a.triggeredAt && (
                  <span className="text-[9px] text-slate-600">
                    {new Date(a.triggeredAt).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
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
};

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK TRADE WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

export const BlockTradeWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { trades, loading } = useBlockTrades(coin);
  const { setHeaderRight } = useCardHeader();
  const [minUSD, setMinUSD] = useState(50_000);

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
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
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />5s
        </span>
        <CoinTabs v={coin} set={setCoin} />
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.map((t, i) => {
            const isBuy = t.direction === 'buy';
            const dirColor = isBuy ? '#25e889' : '#f87171';
            const typeColor = t.optType === 'C' ? '#4ea1ff' : '#f59e0b';
            const sizeEmphasis = t.notionalUSD >= 1_000_000;
            return (
              <div
                key={t.tradeId}
                className={cn(
                  'grid grid-cols-[44px_1fr_44px_56px_56px_60px] gap-x-2 px-3 py-2 border-b border-white/[0.025] transition-colors hover:bg-white/[0.02]',
                  i === 0 && 'bg-white/[0.015]',
                )}
              >
                <span className="font-mono text-[10px] text-white/30">{relTime(t.ts)}</span>
                <div className="min-w-0">
                  <span className="font-mono text-[10px] font-semibold" style={{ color: typeColor }}>
                    {t.optType}
                  </span>
                  <span className="font-mono text-[10px] text-white/55 ml-1">
                    {t.strike.toLocaleString()} · {t.expiry}
                  </span>
                </div>
                <span className="font-mono text-[10px] font-bold" style={{ color: dirColor }}>
                  {isBuy ? 'BUY' : 'SELL'}
                </span>
                <span className="font-mono text-[10px] text-white/50 tnum">
                  {t.iv > 0 ? `${t.iv.toFixed(1)}%` : '—'}
                </span>
                <span className="font-mono text-[10px] text-white/50 tnum">
                  {t.amount >= 1000 ? `${(t.amount / 1000).toFixed(1)}K` : t.amount.toFixed(1)}
                </span>
                <span className={cn('font-mono text-[10px] tnum font-bold', sizeEmphasis ? 'text-amber-400' : 'text-white/40')}>
                  {fmtUSD(t.notionalUSD)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="px-3 py-1.5 text-[9px] text-white/15 shrink-0 border-t border-white/[0.04]">
        名义金额 = 合约数 × 指数价格 · 仅显示 ≥ {fmtUSD(minUSD)} 的成交 · Deribit
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// STRATEGY PRICER WIDGET
// ═══════════════════════════════════════════════════════════════════════════════

import { bsCall as mBsCall, bsPut as mBsPut } from '../lib/bs-math';

export const StrategyPricerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();

  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {data && <LiveBadge />}
        <CoinTabs v={coin} set={setCoin} />
      </div>
    );
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  if (loading && !data) return <Skeleton />;
  if (!data || !data.expiries.length) return <div className="p-3 text-[11px] text-white/20">暂无数据</div>;

  const spot = data.spot;
  const exps = data.expiries.slice(0, 4);

  const fmtPct = (v: number) => `${v >= 0 ? '' : ''}${v.toFixed(2)}%`;
  const fmtUSD = (v: number) => {
    if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `$${v.toFixed(0)}`;
  };

  const rows = exps.map(e => {
    const { calls, puts, atmIV, rr25, T, daysToExp, label } = e;

    const straddlePerCoin = 2 * mBsCall(spot, spot, T, atmIV);
    const straddlePct     = (straddlePerCoin / spot) * 100;
    const straddleUSD     = straddlePerCoin * spot;
    const upBE   = spot * (1 + straddlePct / 100);
    const downBE = spot * (1 - straddlePct / 100);

    const call25 = calls.reduce((best, o) =>
      Math.abs(o.delta - 0.25) < Math.abs(best.delta - 0.25) ? o : best, calls[0]);
    const put25  = puts.reduce((best, o) =>
      Math.abs(Math.abs(o.delta) - 0.25) < Math.abs(Math.abs(best.delta) - 0.25) ? o : best, puts[0]);

    const stranglePct = call25 && put25
      ? ((mBsCall(spot, call25.strike, T, call25.iv) + mBsPut(spot, put25.strike, T, put25.iv)) / spot) * 100
      : null;

    const strangleWidth = call25 && put25
      ? ((call25.strike - put25.strike) / spot) * 100
      : null;

    return { label, daysToExp, straddlePct, straddleUSD, upBE, downBE, stranglePct, strangleWidth, rr25, atmIV };
  });

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-1.5 shrink-0 border-b border-white/[0.05]">
        {['到期', 'ATM IV', 'Straddle', '上行 BE', '下行 BE', '25δ Strangle', 'RR25'].map(h => (
          <span key={h} className="text-[9px] font-bold uppercase tracking-[0.06em] text-white/20">{h}</span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((r, i) => {
          const isNear = r.daysToExp <= 7;
          const rrColor = r.rr25 < -3 ? '#f87171' : r.rr25 > 3 ? '#25e889' : 'rgba(255,255,255,0.4)';
          return (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[48px_56px_72px_1fr_1fr_1fr_72px] gap-x-2 px-3 py-2.5 border-b border-white/[0.025] hover:bg-white/[0.015] transition-colors items-center',
                isNear && 'bg-amber-500/[0.03]',
              )}
            >
              <div>
                <div className={cn('font-mono text-[11px] font-bold', isNear ? 'text-amber-400' : 'text-white/60')}>
                  {r.label}
                </div>
                <div className="text-[8.5px] text-white/20">{r.daysToExp}天</div>
              </div>

              <span className="font-mono text-[11px] text-white/55">{r.atmIV.toFixed(1)}%</span>

              <div>
                <div className="font-mono text-[11px] font-bold text-[#a78bfa]">{fmtPct(r.straddlePct)}</div>
                <div className="text-[8.5px] text-white/20">{fmtUSD(r.straddleUSD)}</div>
              </div>

              <div>
                <div className="font-mono text-[10.5px] text-[#25e889]">{fmtUSD(r.upBE)}</div>
                <div className="text-[8.5px] text-white/20">+{r.straddlePct.toFixed(2)}%</div>
              </div>

              <div>
                <div className="font-mono text-[10.5px] text-[#f87171]">{fmtUSD(r.downBE)}</div>
                <div className="text-[8.5px] text-white/20">-{r.straddlePct.toFixed(2)}%</div>
              </div>

              <span className="font-mono text-[11px] text-[#F59E0B]">
                {r.stranglePct !== null ? fmtPct(r.stranglePct) : '—'}
                {r.strangleWidth !== null && (
                  <span className="text-[8.5px] text-white/20 ml-1">±{r.strangleWidth.toFixed(0)}%</span>
                )}
              </span>

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
};
