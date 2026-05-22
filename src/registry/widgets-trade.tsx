import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import { bsCall, bsPut, bsDelta, bsGamma, bsVega, bsTheta } from '../lib/bs-math';
import type { DeribitData } from './types';
import { subscribeData, fetchDeribitOptions, CACHE_TTL } from './data-layer';
import {
  CoinControlProps, useCoinControl, CoinTabs,
} from './ui-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// WatchlistWidget
// ═══════════════════════════════════════════════════════════════════════════════

const WATCHLIST_SET = new Set<string>();
interface WatchItem {
  instrument: string; bid: number; ask: number;
  iv: number; delta: number; mark: number;
  oi: number; oiDelta: number; ts: number;
}
const WATCH_OI_SNAP = new Map<string, number>();
const WATCH_CACHE2  = new Map<string, WatchItem>();

async function refreshWatchItems(): Promise<WatchItem[]> {
  const instruments = [...WATCHLIST_SET];
  const results = await Promise.allSettled(
    instruments.map(async inst => {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      const t = res.result;
      if (!t) throw new Error('no result');
      const oi: number = t.open_interest ?? 0;
      if (!WATCH_OI_SNAP.has(inst)) WATCH_OI_SNAP.set(inst, oi);
      const item: WatchItem = {
        instrument: inst, bid: t.best_bid_price ?? 0, ask: t.best_ask_price ?? 0,
        iv: t.mark_iv ?? 0, delta: t.greeks?.delta ?? 0, mark: t.mark_price ?? 0,
        oi, oiDelta: oi - (WATCH_OI_SNAP.get(inst) ?? oi), ts: Date.now(),
      };
      WATCH_CACHE2.set(inst, item);
      return item;
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<WatchItem>).value);
}

export const WatchlistWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [items, setItems] = useState<WatchItem[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  useEffect(() => {
    let alive = true;
    const load = () => refreshWatchItems().then(r => { if (alive) setItems(r); }).catch(() => {});
    load();
    const id = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const addInstrument = async () => {
    const inst = input.trim().toUpperCase();
    if (!inst) return;
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      if (!res.result) { setError('合约不存在'); return; }
      WATCHLIST_SET.add(inst);
      setInput(''); setError('');
      const all = await refreshWatchItems();
      setItems(all);
    } catch { setError('验证失败'); }
  };

  const placeholder = coin === 'BTC' ? 'e.g. BTC-27JUN25-100000-C' : 'e.g. ETH-27JUN25-3000-C';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
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
          <div className="grid px-3 py-1 text-[8px] text-slate-600 uppercase tracking-wider border-b border-white/4"
            style={{ gridTemplateColumns: '1fr 56px 56px 44px 44px 50px 50px 24px' }}>
            <span>合约</span><span className="text-right">Bid</span><span className="text-right">Ask</span>
            <span className="text-right">IV</span><span className="text-right">Δ</span>
            <span className="text-right">OI</span><span className="text-right">OIΔ</span><span />
          </div>
          {items.map(item => {
            const spread = item.ask > 0 && item.bid > 0 ? item.ask - item.bid : null;
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
                <button onClick={() => { WATCHLIST_SET.delete(item.instrument); refreshWatchItems().then(r => setItems(r)); }}
                  className="text-[9px] text-slate-700 hover:text-rose-400 transition-colors text-right">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PositionTracker + PayoffProfile shared
// ═══════════════════════════════════════════════════════════════════════════════

interface UserPosition {
  id: string;
  instrument: string;
  qty: number;
}

export const POS_STORE: UserPosition[] = [];

interface LivePosition extends UserPosition {
  mark: number; iv: number;
  delta: number; gamma: number; vega: number; theta: number;
  dollarDelta: number; dollarGamma: number; dollarVega: number; dollarTheta: number;
  spot: number; error?: string;
}

async function fetchLivePositions(positions: UserPosition[]): Promise<LivePosition[]> {
  return Promise.all(positions.map(async pos => {
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(pos.instrument)}`
      ).then(r => r.json());
      const t = res.result;
      if (!t) throw new Error('no result');
      const spot: number = t.underlying_price ?? t.index_price ?? 1;
      const g = t.greeks ?? {};
      const delta: number = (g.delta ?? 0) * pos.qty;
      const gamma: number = (g.gamma ?? 0) * pos.qty;
      const vega:  number = (g.vega  ?? 0) * pos.qty;
      const theta: number = (g.theta ?? 0) * pos.qty;
      return {
        ...pos,
        mark: t.mark_price ?? 0,
        iv: t.mark_iv ?? 0,
        delta, gamma, vega, theta,
        dollarDelta: delta * spot,
        dollarGamma: gamma * spot * spot / 100,
        dollarVega:  vega  / 100,
        dollarTheta: theta * spot,
        spot,
      };
    } catch {
      return { ...pos, mark: 0, iv: 0, delta: 0, gamma: 0, vega: 0, theta: 0,
               dollarDelta: 0, dollarGamma: 0, dollarVega: 0, dollarTheta: 0, spot: 0, error: '获取失败' };
    }
  }));
}

export const PositionTrackerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [positions, setPositions] = useState<UserPosition[]>([...POS_STORE]);
  const [live, setLive] = useState<LivePosition[]>([]);
  const [input, setInput] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHeaderRight(null);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  useEffect(() => {
    if (positions.length === 0) { setLive([]); return; }
    let alive = true;
    const load = () => fetchLivePositions(positions).then(r => { if (alive) setLive(r); });
    load();
    const id = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(id); };
  }, [positions]);

  const addPosition = async () => {
    const inst = input.trim().toUpperCase();
    const qty  = parseFloat(qtyInput);
    if (!inst || isNaN(qty) || qty === 0) { setAddError('请输入合约和数量'); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://www.deribit.com/api/v2/public/ticker?instrument_name=${encodeURIComponent(inst)}`
      ).then(r => r.json());
      if (!res.result) { setAddError('合约不存在'); setLoading(false); return; }
      const newPos: UserPosition = { id: `${inst}-${Date.now()}`, instrument: inst, qty };
      POS_STORE.push(newPos);
      setPositions([...POS_STORE]);
      setInput(''); setQtyInput('1'); setAddError('');
    } catch { setAddError('验证失败'); }
    setLoading(false);
  };

  const removePosition = (id: string) => {
    const idx = POS_STORE.findIndex(p => p.id === id);
    if (idx >= 0) POS_STORE.splice(idx, 1);
    setPositions([...POS_STORE]);
  };

  const netDelta  = live.reduce((s, p) => s + p.dollarDelta, 0);
  const netGamma  = live.reduce((s, p) => s + p.dollarGamma, 0);
  const netVega   = live.reduce((s, p) => s + p.dollarVega,  0);
  const netTheta  = live.reduce((s, p) => s + p.dollarTheta, 0);

  const spotForPnL = live[0]?.spot ?? 0;
  const pnlUp5   = netDelta * 0.05 + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;
  const pnlDn5   = netDelta * (-0.05) + 0.5 * netGamma * (spotForPnL * 0.05) * (spotForPnL * 0.05) / spotForPnL;

  const fmtK = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toFixed(0)}`;
  const gColor = (v: number) => v > 0 ? 'var(--nexus-green)' : v < 0 ? 'var(--nexus-red)' : '#64748b';

  const placeholder = coin === 'BTC' ? 'BTC-27JUN25-100000-C' : 'e.g. ETH-27JUN25-3000-P';

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 shrink-0 border-b border-white/6">
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setAddError(''); }}
          onKeyDown={e => e.key === 'Enter' && addPosition()}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[10px] font-mono text-slate-200 border border-white/10 rounded px-2 py-1 outline-none focus:border-white/30 placeholder:text-slate-700"
        />
        <input
          value={qtyInput}
          onChange={e => setQtyInput(e.target.value)}
          placeholder="qty"
          className="w-[52px] bg-transparent text-[10px] font-mono text-center text-slate-200 border border-white/10 rounded px-1 py-1 outline-none focus:border-white/30"
        />
        <button onClick={addPosition} disabled={loading}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-slate-300 hover:bg-white/8 transition-colors disabled:opacity-40">
          + 加仓
        </button>
        {addError && <span className="text-[9px] text-rose-400">{addError}</span>}
      </div>

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
};

// ═══════════════════════════════════════════════════════════════════════════════
// PayoffProfileWidget
// ═══════════════════════════════════════════════════════════════════════════════

function parseInstForPayoff(inst: string): { K: number; type: 'C' | 'P'; expiryLabel: string } | null {
  const parts = inst.split('-');
  if (parts.length !== 4) return null;
  const [, expiryRaw, strikeStr, typeStr] = parts;
  const K = Number(strikeStr);
  if (isNaN(K)) return null;
  return { K, type: typeStr === 'C' ? 'C' : 'P', expiryLabel: expiryRaw };
}

export const PayoffProfileWidget = () => {
  const { setHeaderRight } = useCardHeader();
  const [live, setLive] = useState<LivePosition[]>([]);
  const [posCount, setPosCount] = useState(POS_STORE.length);

  useEffect(() => {
    setHeaderRight(<span className="text-[9px] text-slate-600">基于当前 mark 价格，到期日盈亏</span>);
    return () => setHeaderRight(null);
  }, [setHeaderRight]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const snap = [...POS_STORE];
      setPosCount(snap.length);
      if (!snap.length) { setLive([]); return; }
      fetchLivePositions(snap).then(r => { if (alive) setLive(r); }).catch(() => {});
    };
    load();
    const id = setInterval(load, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (posCount === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
      请先在「持仓追踪」中添加合约
    </div>
  );

  const spot = live[0]?.spot ?? 0;
  if (!spot || live.length === 0) return (
    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
      加载中…
    </div>
  );

  const STEPS = 160;
  const lo = spot * 0.65; const hi = spot * 1.35;
  const xs = Array.from({ length: STEPS }, (_, i) => lo + (hi - lo) * i / (STEPS - 1));

  const positions = live.filter(p => !p.error);
  const ys = xs.map(x => {
    return positions.reduce((total, p) => {
      const parsed = parseInstForPayoff(p.instrument);
      if (!parsed) return total;
      const { K, type } = parsed;
      const intrinsic = type === 'C' ? Math.max(x - K, 0) : Math.max(K - x, 0);
      const costUSD   = p.mark * p.spot;
      const pnl       = (intrinsic - costUSD) * p.qty;
      return total + pnl;
    }, 0);
  });

  const breakevens: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i - 1] * ys[i] < 0) {
      const be = xs[i - 1] + (xs[i] - xs[i - 1]) * Math.abs(ys[i - 1]) / (Math.abs(ys[i - 1]) + Math.abs(ys[i]));
      breakevens.push(be);
    }
  }

  const W = 800; const H = 140;
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const pad  = (maxY - minY) * 0.1 || 1;
  const yLo  = minY - pad; const yHi = maxY + pad;

  const toSvgX = (x: number) => ((x - lo) / (hi - lo)) * W;
  const toSvgY = (y: number) => H - ((y - yLo) / (yHi - yLo)) * H;
  const zero   = toSvgY(0);
  const spotX  = toSvgX(spot);

  const pts: [number, number][] = xs.map((x, i) => [toSvgX(x), toSvgY(ys[i])]);
  const pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaAbove = `${pathD} L${W},${zero} L0,${zero} Z`;
  const areaBelow = `${pathD} L${W},${zero} L0,${zero} Z`;

  const maxLoss   = Math.min(...ys);
  const maxProfit = Math.max(...ys);

  return (
    <div className="w-full h-full flex flex-col min-h-0 px-3 pt-1 pb-2">
      <div className="flex items-center gap-4 mb-1 shrink-0">
        <span className="text-[9px] text-slate-600">{positions.length} 个持仓</span>
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
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
          <line x1="0" y1={zero} x2={W} y2={zero} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4,4" />
          <clipPath id="profitClip"><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <path d={areaAbove} fill="rgba(37,167,80,0.18)" clipPath="url(#profitClip)" />
          <clipPath id="lossClip"><rect x="0" y={zero} width={W} height={H - zero} /></clipPath>
          <path d={areaBelow} fill="rgba(244,63,94,0.18)" clipPath="url(#lossClip)" />
          <path d={pathD} fill="none" stroke="var(--nexus-accent)" strokeWidth="2" />
          <line x1={spotX} y1="0" x2={spotX} y2={H} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="3,3" />
          {breakevens.map((be, i) => (
            <line key={i} x1={toSvgX(be)} y1="0" x2={toSvgX(be)} y2={H}
              stroke="rgba(251,191,36,0.5)" strokeWidth="1" strokeDasharray="2,4" />
          ))}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-0.5 shrink-0">
        <span className="text-[9px] text-slate-700">${(lo / 1000).toFixed(0)}K</span>
        <span className="text-[9px] text-slate-500">当前 Spot {spot >= 10000 ? spot.toLocaleString('en-US', { maximumFractionDigits: 0 }) : spot.toFixed(1)}</span>
        <span className="text-[9px] text-slate-700">${(hi / 1000).toFixed(0)}K</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// VerticalSpreadPricerWidget
// ═══════════════════════════════════════════════════════════════════════════════

type SpreadType = 'bull-call' | 'bear-put' | 'risk-reversal';

export const VerticalSpreadPricerWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const [ddata, setDdata]         = useState<DeribitData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [spreadType, setSpreadType] = useState<SpreadType>('bull-call');
  const [expIdx, setExpIdx]       = useState(0);
  const [buyStrike, setBuyStrike] = useState<number | null>(null);
  const [sellStrike, setSellStrike] = useState<number | null>(null);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
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

  useEffect(() => { setBuyStrike(null); setSellStrike(null); }, [expIdx, spreadType]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const S = ddata.spot;
  const exps = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (!exps.length) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  const safeIdx = Math.min(expIdx, exps.length - 1);
  const exp = exps[safeIdx];
  const T   = Math.max(exp.daysToExp / 365, 0.001);

  const callStrikes: number[] = [...new Set<number>(exp.calls.map(c => c.strike))].sort((a, b) => a - b);
  const putStrikes:  number[] = [...new Set<number>(exp.puts.map(p => p.strike))].sort((a, b) => a - b);

  const buyStrikes  = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : callStrikes;
  const sellStrikes = spreadType === 'bull-call' ? callStrikes
    : spreadType === 'bear-put' ? putStrikes
    : putStrikes;

  const getIV = (strike: number, type: 'C' | 'P') => {
    const arr = type === 'C' ? exp.calls : exp.puts;
    return arr.find(o => o.strike === strike)?.iv ?? exp.atmIV;
  };

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
    const net = buyPrice - sellPrice;

    let maxProfit = 0; let maxLoss = 0;
    let beLower = 0; let beUpper: number | null = null;

    if (spreadType === 'bull-call') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net;
      maxLoss   = net;
      beLower   = Math.min(buyStrike, sellStrike) + net;
    } else if (spreadType === 'bear-put') {
      maxProfit = Math.abs(buyStrike - sellStrike) - net;
      maxLoss   = net;
      beLower   = Math.max(buyStrike, sellStrike) - net;
    } else {
      maxProfit = Infinity;
      maxLoss   = -Infinity;
      beLower   = buyStrike  + net;
      beUpper   = sellStrike - net;
    }

    const netDelta = bsDelta(S, buyStrike, T, buyIV, buyType) - bsDelta(S, sellStrike, T, sellIV, sellType);
    const netGamma = bsGamma(S, buyStrike, T, buyIV) - bsGamma(S, sellStrike, T, sellIV);
    const netVega2  = bsVega(S, buyStrike, T, buyIV) - bsVega(S, sellStrike, T, sellIV);
    const netTheta = bsTheta(S, buyStrike, T, buyIV) - bsTheta(S, sellStrike, T, sellIV);

    result = { buyPrice, sellPrice, net, maxProfit, maxLoss, beLower, beUpper, netDelta, netGamma, netVega: netVega2, netTheta };
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

      {!result ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-slate-500">
          选择买腿和卖腿行权价
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-2 flex flex-col gap-2">
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
};

// ═══════════════════════════════════════════════════════════════════════════════
// RollCostWidget
// ═══════════════════════════════════════════════════════════════════════════════

export const RollCostWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { setHeaderRight } = useCardHeader();
  const { data: ddata, loading } = useCoinData(coin);

  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);

  if (loading || !ddata) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">加载中…</div>;

  const S2 = ddata.spot;
  const exps2 = ddata.expiries.filter(e => e.daysToExp >= 1 && e.atmIV > 0);
  if (exps2.length < 2) return <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">暂无数据</div>;

  const straddlePrices = exps2.map(exp2 => {
    const allStrikes2 = [...exp2.calls.map(c => c.strike), ...exp2.puts.map(p => p.strike)];
    if (!allStrikes2.length) return { exp: exp2, K: S2, priceUSD: 0, pricePct: 0 };
    const K2 = allStrikes2.reduce((best, s) => Math.abs(s - S2) < Math.abs(best - S2) ? s : best, allStrikes2[0]);
    const T2 = Math.max(exp2.daysToExp / 365, 0.001);
    const iv = exp2.atmIV / 100;
    const priceCoins = bsCall(S2, K2, T2, iv) + bsPut(S2, K2, T2, iv);
    return { exp: exp2, K: K2, priceUSD: priceCoins, pricePct: priceCoins / S2 * 100 };
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
              <th className="text-right pb-1.5 font-normal">IV 差值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rollColor = r.rollUSD > 0 ? 'var(--nexus-red)' : r.rollUSD < 0 ? 'var(--nexus-green)' : '#94a3b8';
              const ivColor   = r.rollVolPt > 0 ? 'var(--nexus-red)' : r.rollVolPt < 0 ? 'var(--nexus-green)' : '#94a3b8';
              return (
                <tr key={i} className="border-t border-white/4">
                  <td className="py-1.5 text-slate-400">{r.from}</td>
                  <td className="py-1.5 text-slate-400">{r.to}</td>
                  <td className="py-1.5 text-right text-slate-400">${r.nearPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right text-slate-400">${r.farPriceUSD.toFixed(0)}</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: rollColor }}>
                    {r.rollUSD >= 0 ? '+' : ''}{r.rollUSD.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right font-bold" style={{ color: ivColor }}>
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
};

function useCoinData(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (alive) { setData(d); setLoading(false); } },
    );
    return () => { alive = false; unsub(); };
  }, [coin]);

  return { data, loading };
}

// Re-export StrategyPricerWidget from widgets-market for trade tab
export { StrategyPricerWidget } from './widgets-market';
