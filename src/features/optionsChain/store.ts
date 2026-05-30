// ═══════════════════════════════════════════════════════════════════════════════
// Shared options-chain selection store (underlying + expiry), so the global nav
// "期权" hover menu and the OptionsChainView page stay in sync. Tiny external
// store via useSyncExternalStore — no extra deps.
// ═══════════════════════════════════════════════════════════════════════════════

import { useSyncExternalStore, useState, useEffect } from 'react';
import type { Coin, DataSource } from './chainModel';
import { fetchOptionChain } from './bybitTickers';
import { fetchDeribitOptions } from '../../registry/data/deribit';

// Underlying (标的) — the name encodes coin + data source.
//   BTC / ETH         → 币本位 (coin-margined) → Deribit (Inverse)
//   BTC_USDC/ETH_USDC → Deribit (Linear · USDC)
//   BTC_USDT/ETH_USDT → Bybit  (Linear · USDT)
export const UNDERLYINGS: { value: string; tag: string }[] = [
  { value: 'BTC', tag: '币本位' },
  { value: 'ETH', tag: '币本位' },
  { value: 'BTC_USDC', tag: 'Deribit' },
  { value: 'ETH_USDC', tag: 'Deribit' },
  { value: 'BTC_USDT', tag: 'Bybit' },
  { value: 'ETH_USDT', tag: 'Bybit' },
];

// Grouped like Deribit's expiry picker (Inverse | Linear), tagged by source.
export const UNDERLYING_GROUPS: { title: string; tag: string; source: DataSource; items: { value: string; coin: Coin }[] }[] = [
  { title: 'Inverse · 币本位', tag: '币本位', source: 'deribit', items: [{ value: 'BTC', coin: 'BTC' }, { value: 'ETH', coin: 'ETH' }] },
  { title: 'Linear · USDC', tag: 'Deribit', source: 'deribit', items: [{ value: 'BTC_USDC', coin: 'BTC' }, { value: 'ETH_USDC', coin: 'ETH' }] },
  { title: 'Linear · USDT', tag: 'Bybit', source: 'bybit', items: [{ value: 'BTC_USDT', coin: 'BTC' }, { value: 'ETH_USDT', coin: 'ETH' }] },
];

export const coinOf = (u: string): Coin => (u.startsWith('ETH') ? 'ETH' : 'BTC');
export const sourceOf = (u: string): DataSource => (u.endsWith('USDT') ? 'bybit' : 'deribit');
export const tagColor = (tag: string) =>
  tag === 'Bybit' ? '#f7a600' : tag === 'Deribit' ? '#1E90FF' : 'rgba(255,255,255,0.45)';

/** Canonical underlying for a (coin, source) pair — used by the source toggle. */
export const underlyingFor = (coin: Coin, source: DataSource) =>
  `${coin}_${source === 'bybit' ? 'USDT' : 'USDC'}`;

export interface ExpiryMeta { key: string; label: string; daysToExp: number; dateLabel: string }

// ── Selection state ──────────────────────────────────────────────────────────

interface OCState { underlying: string; expiryIdx: number }

let state: OCState = { underlying: 'BTC_USDC', expiryIdx: 0 };
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
};

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useOCStore<T>(selector: (s: OCState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

// ── Per-underlying expiry lists (for the Deribit-style picker) ────────────────

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fmtShortDate = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
};

export type ExpiryMap = Record<string, ExpiryMeta[]>;

// Module-level cache so re-opening the menu shows data instantly.
let expiryCache: ExpiryMap = {};

/** Fetch expiry lists for every underlying (Deribit BTC/ETH + Bybit BTC/ETH). Cached. */
export function useUnderlyingExpiries(): ExpiryMap {
  const [map, setMap] = useState<ExpiryMap>(expiryCache);

  useEffect(() => {
    let active = true;
    (async () => {
      const [dBTC, dETH, bBTC, bETH] = await Promise.all([
        fetchDeribitOptions('BTC').catch(() => null),
        fetchDeribitOptions('ETH').catch(() => null),
        fetchOptionChain('BTC').catch(() => null),
        fetchOptionChain('ETH').catch(() => null),
      ]);
      if (!active) return;
      const fromDeribit = (d: Awaited<ReturnType<typeof fetchDeribitOptions>> | null): ExpiryMeta[] =>
        d ? d.expiries.map(e => ({ key: e.label, label: e.label, daysToExp: e.daysToExp, dateLabel: fmtShortDate(Date.now() + e.daysToExp * 86_400_000) })) : [];
      const fromBybit = (d: Awaited<ReturnType<typeof fetchOptionChain>> | null): ExpiryMeta[] =>
        d ? d.expiries.map(e => ({ key: e.label, label: e.label, daysToExp: e.daysToExp, dateLabel: fmtShortDate(e.expiryTs) })) : [];
      const next: ExpiryMap = {
        BTC: fromDeribit(dBTC), BTC_USDC: fromDeribit(dBTC),
        ETH: fromDeribit(dETH), ETH_USDC: fromDeribit(dETH),
        BTC_USDT: fromBybit(bBTC), ETH_USDT: fromBybit(bETH),
      };
      expiryCache = next;
      setMap(next);
    })();
    return () => { active = false; };
  }, []);

  return map;
}
