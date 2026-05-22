import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useCardHeader } from '../components/card/WidgetCard';
import type { Coin } from '../features/monitor/types';
import type { ExpiryGroup } from './types';

export const GRID   = 'rgba(255,255,255,0.07)';
export const TXT    = 'rgba(255,255,255,0.32)';
export const BRAND  = 'rgba(37,232,137,0.92)';
export const RED    = 'rgba(202,63,100,0.92)';
export const YELLOW = '#F59E0B';
export const BLUE   = '#4ea1ff';
export const PURPLE = '#a78bfa';

export function GlobalGradDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true"
      style={{ position: 'absolute', overflow: 'hidden', pointerEvents: 'none', opacity: 0 }}>
      <defs>
        <linearGradient id="wg-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#25e889" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#25e889" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-green-strong" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#25e889" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#25e889" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ca3f64" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ca3f64" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-yellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ea1ff" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#4ea1ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-purple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wg-red-inv" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ca3f64" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ca3f64" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function ivrColor(r: number) { return r <= 30 ? '#25a750' : r <= 70 ? '#F59E0B' : '#ca3f64'; }
export function ivrLabel(r: number) { return r <= 20 ? '极低' : r <= 40 ? '偏低' : r <= 60 ? '中性' : r <= 80 ? '偏高' : '极高'; }
export function pcrColor(p: number) { return p < 0.7 ? '#25a750' : p < 1.0 ? '#F59E0B' : '#ca3f64'; }
export function pcrLabel(p: number) { return p < 0.7 ? '偏多' : p < 1.0 ? '中性' : '偏空'; }

export type CoinControlProps = { coin?: Coin; onCoinChange?: (c: Coin) => void };

export function useCoinControl({ coin: coinProp, onCoinChange }: CoinControlProps) {
  const [localCoin, setLocalCoin] = useState<Coin>(coinProp ?? 'BTC');
  useEffect(() => { if (coinProp !== undefined) setLocalCoin(coinProp); }, [coinProp]);
  const coin = localCoin;
  const setCoin = (c: Coin) => { setLocalCoin(c); onCoinChange?.(c); };
  return { coin, setCoin };
}

export function WidgetShell({ children, coin, setCoin }: { children: React.ReactNode; coin: Coin; setCoin: (c: Coin) => void }) {
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinTabs v={coin} set={setCoin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight]);
  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export const CoinTabs = ({ v, set }: { v: Coin; set: (c: Coin) => void }) => (
  <div className="flex gap-0.5 rounded-[18px] p-0.5 bg-[color:var(--widget-glass-dim)]">
    {(['BTC', 'ETH'] as Coin[]).map(c => (
      <button key={c} onClick={() => set(c)}
        className={cn('text-[12px] font-bold px-2.5 py-0.5 rounded-[18px] transition-colors outline-none',
          v === c
            ? (c === 'BTC' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400')
            : 'text-slate-600 hover:text-slate-400'
        )}>
        {c}
      </button>
    ))}
  </div>
);

export const LiveBadge = () => (
  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400/70 uppercase tracking-wider">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
    实时
  </span>
);

export const Skeleton = () => (
  <div className="w-full h-full flex flex-col gap-2 p-3 overflow-hidden">
    <div className="relative flex-1 min-h-0 rounded-[10px] overflow-hidden bg-white/[0.03]">
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

export function pickExpiries(expiries: ExpiryGroup[], targets: number[]): ExpiryGroup[] {
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
