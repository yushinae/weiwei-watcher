// ═══════════════════════════════════════════════════════════════════════════════
// Shared options-chain selection store (underlying + expiry), so the global nav
// "期权" hover menu and the OptionsChainView page stay in sync. Tiny external
// store via useSyncExternalStore — no extra deps.
// ═══════════════════════════════════════════════════════════════════════════════

import { useSyncExternalStore } from 'react';
import type { Coin, DataSource } from './chainModel';

// Underlying (标的) — the name encodes coin + data source.
//   BTC / ETH         → 币本位 (coin-margined) → Deribit
//   BTC_USDC/ETH_USDC → Deribit
//   BTC_USDT/ETH_USDT → Bybit
export const UNDERLYINGS: { value: string; tag: string }[] = [
  { value: 'BTC', tag: '币本位' },
  { value: 'ETH', tag: '币本位' },
  { value: 'BTC_USDC', tag: 'Deribit' },
  { value: 'ETH_USDC', tag: 'Deribit' },
  { value: 'BTC_USDT', tag: 'Bybit' },
  { value: 'ETH_USDT', tag: 'Bybit' },
];

export const coinOf = (u: string): Coin => (u.startsWith('ETH') ? 'ETH' : 'BTC');
export const sourceOf = (u: string): DataSource => (u.endsWith('USDT') ? 'bybit' : 'deribit');
export const tagColor = (tag: string) =>
  tag === 'Bybit' ? '#f7a600' : tag === 'Deribit' ? 'var(--db-accent)' : 'rgba(255,255,255,0.45)';

/** Canonical underlying for a (coin, source) pair — used by the source toggle. */
export const underlyingFor = (coin: Coin, source: DataSource) =>
  `${coin}_${source === 'bybit' ? 'USDT' : 'USDC'}`;

export interface ExpiryMeta { key: string; label: string; daysToExp: number }

interface OCState {
  underlying: string;
  expiryIdx: number;
  expiries: ExpiryMeta[];
}

let state: OCState = { underlying: 'BTC_USDC', expiryIdx: 0, expiries: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const ocStore = {
  getState: () => state,
  setUnderlying(u: string) {
    if (u === state.underlying) return;
    state = { ...state, underlying: u, expiryIdx: 0 };
    emit();
  },
  setExpiryIdx(i: number) {
    if (i === state.expiryIdx) return;
    state = { ...state, expiryIdx: i };
    emit();
  },
  setExpiries(e: ExpiryMeta[]) {
    const same = e.length === state.expiries.length && e.every((x, i) => x.key === state.expiries[i]?.key);
    if (same) return;
    state = { ...state, expiries: e };
    emit();
  },
};

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useOCStore<T>(selector: (s: OCState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}
