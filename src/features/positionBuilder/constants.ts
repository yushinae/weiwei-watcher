// Static configuration for the position builder: symbol presets, scenario / heatmap
// axes, strategy templates, input styling, and small formatting helpers.

import type { Leg, RightTab } from './types';

export const PRESETS: Record<string, { spot: number; iv: number; strikeStep: number }> = {
  BTC: { spot: 65000, iv: 0.55, strikeStep: 1000 },
  ETH: { spot: 3000, iv: 0.7, strikeStep: 50 },
  SOL: { spot: 150, iv: 0.85, strikeStep: 5 },
};

export const DERIBIT_INDEX: Record<string, string> = {
  BTC: 'btc_usd',
  ETH: 'eth_usd',
  SOL: 'sol_usd',
};

export const N_POINTS = 120;

export const SPOT_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];
export const IV_OFFSETS   = [0.30, 0.15, 0, -0.15, -0.30];

export const SCENARIO_PRESETS: { label: string; desc: string; spotPct: number; ivAdj: number; historical?: boolean }[] = [
  // ── Generic stress ──────────────────────────────────────────────────────────
  { label: '急跌',    desc: '−20% / IV +30',  spotPct: -20, ivAdj:  0.30 },
  { label: '崩盘',    desc: '−30% / IV +50',  spotPct: -30, ivAdj:  0.50 },
  { label: '暴涨',    desc: '+20% / IV −15',  spotPct:  20, ivAdj: -0.15 },
  { label: 'IV 压缩', desc: '0% / IV −20',    spotPct:   0, ivAdj: -0.20 },
  // ── Historical events ───────────────────────────────────────────────────────
  { label: 'Black Thu', desc: '2020-03-12  −49% / IV +120', spotPct: -49, ivAdj:  1.20, historical: true },
  { label: 'LUNA 崩',   desc: '2022-05-12  −57% / IV +160', spotPct: -57, ivAdj:  1.60, historical: true },
  { label: 'FTX 暴雷',  desc: '2022-11-09  −26% / IV +80',  spotPct: -26, ivAdj:  0.80, historical: true },
  { label: '21年顶',    desc: '2021-11↓  −53% / IV +60',   spotPct: -53, ivAdj:  0.60, historical: true },
  { label: '21年牛',    desc: '2021-10 +102% / IV −30',    spotPct: 102, ivAdj: -0.30, historical: true },
];

// ── Greeks Heatmap axis configuration ────────────────────────────────────────
export const HEATMAP_SPOT = [-30, -20, -10, 0, 10, 20, 30];
export const HEATMAP_IV   = [0.40, 0.20, 0, -0.20, -0.40];
export const LADDER_OFFSETS = [-15, -10, -5, 0, 5, 10, 15];

export const RIGHT_TABS: { id: RightTab; label: string; icon: string }[] = [
  { id: 'chart',     label: '行情',   icon: '📊' },
  { id: 'scenario',  label: '情景',   icon: '🎛' },
  { id: 'greeks',    label: '希腊',   icon: '⚡' },
  { id: 'risk',      label: '风险',   icon: '📉' },
  { id: 'structure', label: '结构',   icon: '📅' },
];

export const INPUT_CLS = 'h-7 bg-[#2B2D35] rounded-lg px-2 text-[14px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors duration-[120ms] w-full';
export const SELECT_CLS = 'h-7 bg-[#2B2D35] rounded-lg px-2 text-[14px] text-white/85 outline-none focus:bg-[#3A3B40] transition-colors duration-[120ms] cursor-pointer w-full';

export const STORAGE_KEY = 'pb_state_v1';

export function formatHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h - d * 24;
  return rh === 0 ? `${d}d` : `${d}d${rh}h`;
}

// Signed value → green/red/neutral text class.
export const gClass = (val: number) => val > 0 ? 'text-[var(--nexus-green)]' : (val < 0 ? 'text-[var(--nexus-red)]' : 'text-white/55');

export function roundStrike(price: number, step: number) {
  return Math.round(price / step) * step;
}

export const TEMPLATES: Record<string, (spot: number, step: number, nextId: () => number) => Leg[]> = {
  longCall: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  longPut: (spot, step, nextId) => [{ id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 }],
  coveredCall: (spot, step, nextId) => [{ id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.05, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 }],
  bullCallSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  bearPutSpread: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  longStraddle: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
  ],
  shortStrangle: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.90, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.10, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  ironCondor: (spot, step, nextId) => [
    { id: nextId(), side: 1, type: 'put', K: roundStrike(spot * 0.85, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'put', K: roundStrike(spot * 0.92, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot * 1.08, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot * 1.15, step), qty: 1, hoursToExpiry: 24 * 14, entryPremium: 0 },
  ],
  calendar: (spot, step, nextId) => [
    { id: nextId(), side: -1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 7, entryPremium: 0 },
    { id: nextId(), side: 1, type: 'call', K: roundStrike(spot, step), qty: 1, hoursToExpiry: 24 * 30, entryPremium: 0 },
  ],
};
