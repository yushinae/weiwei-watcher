/**
 * Professional Options Chain – Deribit-style 35-column T-Quote with neon glow
 */
import React, {
  useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Download, Filter, ChevronDown, X, Check, Plus, ChevronsUpDown, Maximize2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { useSimTradingStore } from '../store/useSimTradingStore';
import { useDeribitOptionsStream } from '../hooks/useDeribitOptionsStream';
import { ElasticLayout } from '../components/ElasticLayout';
import { Popover, HoverPopover } from '../components/popup/Popup';
import './deribit-options-chain.css';

// ─────────────────────────────────────────────────────────────────────────────
// Black-Scholes Math
// ─────────────────────────────────────────────────────────────────────────────

function normCDF(x: number): number {
  const a = Math.abs(x);
  const k = 1 / (1 + 0.2316419 * a);
  const p = Math.exp(-0.5 * a * a) * 0.3989422804 *
    k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function bsPrice(S: number, K: number, T: number, σ: number, call: boolean) {
  if (T < 1e-9 || σ < 1e-9) return Math.max(0, call ? S - K : K - S);
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * σ * σ * T) / (σ * sq);
  const d2 = d1 - σ * sq;
  return call ? S * normCDF(d1) - K * normCDF(d2) : K * normCDF(-d2) - S * normCDF(-d1);
}
function bsDelta(S: number, K: number, T: number, σ: number, call: boolean) {
  if (T < 1e-9) return call ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + 0.5 * σ * σ * T) / (σ * Math.sqrt(T));
  return call ? normCDF(d1) : normCDF(d1) - 1;
}
function bsGamma(S: number, K: number, T: number, σ: number) {
  if (T < 1e-9) return 0;
  const d1 = (Math.log(S / K) + 0.5 * σ * σ * T) / (σ * Math.sqrt(T));
  return Math.exp(-0.5 * d1 * d1) / (0.3989422804 * S * σ * Math.sqrt(T));
}
function bsVega(S: number, K: number, T: number, σ: number) {
  if (T < 1e-9) return 0;
  const d1 = (Math.log(S / K) + 0.5 * σ * σ * T) / (σ * Math.sqrt(T));
  return S * Math.sqrt(T) * Math.exp(-0.5 * d1 * d1) * 0.3989422804 * 0.01;
}
function bsTheta(S: number, K: number, T: number, σ: number, call: boolean) {
  if (T < 1e-9) return 0;
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * σ * σ * T) / (σ * sq);
  const d2 = d1 - σ * sq;
  const term1 = -S * Math.exp(-0.5 * d1 * d1) * 0.3989422804 * σ / (2 * sq);
  return call
    ? (term1 - 0.02 * K * Math.exp(-0.02 * T) * normCDF(d2)) / 365
    : (term1 + 0.02 * K * Math.exp(-0.02 * T) * normCDF(-d2)) / 365;
}
function xorRng(seed: number) {
  let s = (seed | 1) >>> 0;
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin Config
// ─────────────────────────────────────────────────────────────────────────────

interface CoinCfg { label: string; spot: number; baseIV: number }

const COIN_CFG: Record<string, CoinCfg> = {
  'BTC-USD':   { label: 'BTC', spot: 77000.0, baseIV: 0.58 },
  'ETH-USD':   { label: 'ETH', spot: 2520.0,  baseIV: 0.68 },
  'SOL-USDC':  { label: 'SOL', spot: 165.0, baseIV: 0.48 },
  'SOL-USDT':  { label: 'SOL', spot: 165.0, baseIV: 0.48 },
  'BTC-USDC':  { label: 'BTC', spot: 77000.0, baseIV: 0.58 },
  'BTC-USDT':  { label: 'BTC', spot: 77000.0, baseIV: 0.58 },
  'ETH-USDC':  { label: 'ETH', spot: 2520.0,  baseIV: 0.68 },
  'ETH-USDT':  { label: 'ETH', spot: 2520.0,  baseIV: 0.68 },
  'AVAX-USDC': { label: 'AVAX', spot: 22.5,  baseIV: 0.75 },
  'AVAX-USDT': { label: 'AVAX', spot: 22.5,  baseIV: 0.75 },
  'XRP-USDC':  { label: 'XRP', spot: 2.15,   baseIV: 0.72 },
  'XRP-USDT':  { label: 'XRP', spot: 2.15,   baseIV: 0.72 },
  'TRX-USDC':  { label: 'TRX', spot: 0.245,  baseIV: 0.85 },
  'TRX-USDT':  { label: 'TRX', spot: 0.245,  baseIV: 0.85 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Data Types & Chain Build
// ─────────────────────────────────────────────────────────────────────────────

function genStrikes(S: number) {
  const step = S < 1 ? 0.005 : S < 5 ? 0.05 : S < 20 ? 0.25 : S < 100 ? 1 : S < 500 ? 5 : S < 5000 ? 50 : 500;
  const dp = (step.toString().split('.')[1] ?? '').length;
  const seen = new Set<number>();
  const add = (v: number) => seen.add(parseFloat((Math.round(v / step) * step).toFixed(dp)));
  const wide = step * 5, mid = step * 2;
  for (let k = Math.floor(S * 0.50 / wide) * wide; k <= S * 0.70; k += wide) add(k);
  for (let k = Math.ceil(S  * 0.70 / mid) * mid;  k <= S * 0.88; k += mid)  add(k);
  for (let k = Math.ceil(S  * 0.88 / step) * step; k <= S * 1.12; k += step) add(k);
  for (let k = Math.ceil(S  * 1.12 / mid) * mid;  k <= S * 1.30; k += mid)  add(k);
  for (let k = Math.ceil(S  * 1.30 / wide) * wide; k <= S * 1.50; k += wide) add(k);
  return [...seen].sort((a, b) => a - b);
}
function ivSkew(S: number, K: number, base: number) {
  const lm = Math.log(K / S);
  return Math.min(base * Math.exp(-0.33 * lm + 0.11 * lm * lm), 3.5);
}

export interface Side {
  bid: number | null; ask: number | null; mark: number;
  iv: number; ivBid: number | null; ivAsk: number | null;
  delta: number; gamma: number; vega: number; theta: number;
  oi: number | null; dOI: number | null; size: number | null; pos: number | null;
}
export interface ChainRow {
  strike: number; call: Side; put: Side; isATM: boolean; isITM: boolean;
}

function buildSide(S: number, K: number, T: number, σ: number, call: boolean, r: () => number): Side {
  const mark   = Math.max(bsPrice(S, K, T, σ, call), 0);
  const spread = mark > 1 ? mark * 0.018 : mark > 0.05 ? 0.025 : 0.04;
  const mono   = Math.abs(K / S - 1);
  const liq    = call ? mono < 0.32 : mono < 0.42;
  const dp     = S < 1 ? 6 : S < 10 ? 4 : S < 100 ? 2 : 2;
  const fmt    = (v: number) => parseFloat(v.toFixed(dp));
  return {
    bid:   liq && mark > 0.01 ? fmt(Math.max(mark - spread / 2, 0.001)) : null,
    ask:   mark > 0 ? fmt(mark + spread / 2) : null,
    mark:  fmt(mark),
    iv:    parseFloat((σ * 100).toFixed(2)),
    ivBid: liq && mark > 0.01 ? parseFloat((σ * 100 - 0.4).toFixed(1)) : null,
    ivAsk: mark > 0 ? parseFloat((σ * 100 + 0.4).toFixed(1)) : null,
    delta: parseFloat(bsDelta(S, K, T, σ, call).toFixed(4)),
    gamma: parseFloat(bsGamma(S, K, T, σ).toFixed(6)),
    vega:  parseFloat(bsVega(S, K, T, σ).toFixed(4)),
    theta: parseFloat(bsTheta(S, K, T, σ, call).toFixed(4)),
    oi:    r() > 0.4 ? Math.floor(r() * 500 + 5) : null,
    dOI:   r() > 0.6 ? parseFloat((r() * 8 - 2).toFixed(2)) : null,
    size:  r() > 0.5 ? Math.floor(r() * 80 + 1) : null,
    pos:   r() > 0.75 ? Math.floor(r() * 60 - 30) : null,
  };
}

function buildEmptySide(): Side {
  return {
    bid: null, ask: null, mark: 0,
    iv: 0, ivBid: null, ivAsk: null,
    delta: 0, gamma: 0, vega: 0, theta: 0,
    oi: null, dOI: null, size: null, pos: null,
  };
}

function buildChain(cfg: CoinCfg, T: number, seed: number): ChainRow[] {
  const { spot: S, baseIV } = cfg;
  const rand    = xorRng(seed);
  const strikes = genStrikes(S);
  const atmK    = strikes.reduce((p, c) => Math.abs(c - S) < Math.abs(p - S) ? c : p);
  return strikes.map(K => {
    const σ = ivSkew(S, K, baseIV);
    return { strike: K, isATM: K === atmK, isITM: K < S, call: buildSide(S, K, T, σ, true, rand), put: buildSide(S, K, T, σ, false, rand) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry helpers
// ─────────────────────────────────────────────────────────────────────────────

const MON: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
const MON_S: Record<string, string> = { JAN:'Jan',FEB:'Feb',MAR:'Mar',APR:'Apr',MAY:'May',JUN:'Jun',JUL:'Jul',AUG:'Aug',SEP:'Sep',OCT:'Oct',NOV:'Nov',DEC:'Dec' };

function expiryT(e: string) {
  // support ISO expiry_ts from backend
  if (e.includes('T')) {
    const exp = new Date(e).getTime();
    const ms = exp - Date.now();
    return Math.max(ms / (365.25 * 24 * 3600 * 1000), 1 / (365 * 24));
  }
  const [d, m, y] = e.split(' ');
  const exp = new Date(2000 + parseInt(y), MON[m] ?? 0, parseInt(d));
  return Math.max((exp.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000), 1 / (365 * 24));
}
function expiryDisplay(e: string) {
  if (e.includes('T')) {
    const dt = new Date(e);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }
  const [d, m, y] = e.split(' ');
  return `${d} ${MON_S[m] ?? m} 20${y}`;
}
function expiryDTE(e: string) {
  if (e.includes('T')) {
    const ms = new Date(e).getTime() - Date.now();
    if (ms <= 0) return '已到期';
    const h = Math.floor(ms / 3600000), min = Math.floor((ms % 3600000) / 60000);
    return h < 48 ? `${h}h ${min}m` : `${Math.ceil(h / 24)}天`;
  }
  const [d, m, y] = e.split(' ');
  const ms = new Date(2000 + parseInt(y), MON[m] ?? 0, parseInt(d)).getTime() - Date.now();
  if (ms <= 0) return '已到期';
  const h = Math.floor(ms / 3600000), min = Math.floor((ms % 3600000) / 60000);
  return h < 48 ? `${h}h ${min}m（每周）` : `${Math.ceil(h / 24)}天`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column definitions — 17 columns per side (total 35 with strike center)
// ─────────────────────────────────────────────────────────────────────────────

type ColKey = 'pos'|'oi'|'dOI'|'size'|'ivBid'|'bid'|'mark'|'ask'|'ivAsk'|'delta'|'gamma'|'vega'|'theta';

interface ColDef { key: ColKey; label: string; subLabel?: string; w: number; group: 'base'|'greek'|'extra' }
type ViewCol = ColDef & { id: string; isPlaceholder?: boolean };

// 17 columns per side — matches the spec exactly
const SIDE_COLS: ColDef[] = [
  { key:'pos',   label:'持仓',    subLabel:'Pos',       w:56,  group:'base'  },
  { key:'oi',    label:'未平仓',  subLabel:'OI',        w:58,  group:'extra' },
  { key:'dOI',   label:'OI变动', subLabel:'ΔOI',       w:54,  group:'extra' },
  { key:'size',  label:'数量',    subLabel:'Size',      w:48,  group:'base'  },
  { key:'ivBid', label:'IV买',   subLabel:'IV Bid',    w:62,  group:'base'  },
  { key:'bid',   label:'买价',    subLabel:'Bid',       w:80,  group:'base'  },
  { key:'mark',  label:'标记',    subLabel:'Mark',      w:96,  group:'base'  },
  { key:'ask',   label:'卖价',    subLabel:'Ask',       w:80,  group:'base'  },
  { key:'ivAsk', label:'IV卖',   subLabel:'IV Ask',    w:62,  group:'base'  },
  { key:'delta', label:'Δ',       subLabel:'Delta',     w:60,  group:'greek' },
  { key:'gamma', label:'Γ',       subLabel:'Gamma',     w:68,  group:'greek' },
  { key:'vega',  label:'ν',       subLabel:'Vega',      w:60,  group:'greek' },
  { key:'theta', label:'Θ',       subLabel:'Theta',     w:60,  group:'greek' },
];

// Pad to exactly 17 columns with placeholder cols
const PLACEHOLDER_COLS: ColDef[] = [
  { key:'pos', label:'Rho',   subLabel:'ρ',    w:50, group:'greek' },
  { key:'oi',  label:'Vanna', subLabel:'Vna',  w:56, group:'greek' },
  { key:'dOI', label:'Charm', subLabel:'Chm',  w:56, group:'greek' },
  { key:'size',label:'Speed', subLabel:'Spd',  w:50, group:'greek' },
];

// Build final 17-col list
const ALL_17_COLS: ViewCol[] = [
  ...SIDE_COLS.map(c => ({ ...c, id: c.key })),
  ...PLACEHOLDER_COLS.map(c => ({
    ...c,
    id: c.label.toLowerCase(), // rho / vanna / charm / speed
    isPlaceholder: true,
  })),
];

// Strike 列：桌面端 Deribit 接近 70~76px；保持紧凑以容纳 35 列
const STRIKE_W = 72;
// Keep in sync with CSS: --db-row-h
const ROW_H    = 32;

// Visual constants
const BG_MAIN   = 'var(--db-bg-main)';
const BG_HEADER = 'var(--db-bg-header)';
const BG_ZEBRA  = 'var(--db-bg-row-odd)';
const BG_HOVER  = 'var(--db-bg-hover)';
const BORDER_C  = 'var(--db-border)';
const BORDER_STRONG = 'var(--db-border-strong)';
const GLOW_C    = 'var(--db-accent)';

const TABNUM: React.CSSProperties = {
  fontFamily: '"Inter", "SF Pro Display", "PingFang SC", sans-serif',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  letterSpacing: '-0.02em',
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function fmtV(v: number | null, dec: number) { return v === null ? '—' : v.toFixed(dec); }
function fmtIV(v: number | null) { return v === null ? '—' : v.toFixed(1) + '%'; }

// 统一数值格式：最多保留小数点后 2 位（按需求，强制截断显示精度）
function fmt2(v: number | null) {
  if (v === null) return '—';
  // -0.00 视觉上很脏，归零
  const vv = Math.abs(v) < 0.0005 ? 0 : v;
  return vv.toFixed(2);
}

// Gamma：固定显示 5 位小数，避免科学计数法（例如 0.00001）
function fmtGamma5(gamma: number) {
  const vv = Math.abs(gamma) < 0.0000005 ? 0 : gamma;
  return vv.toFixed(5);
}

function getCellValue(side: Side, col: ViewCol, dec: number): { text: string; colorKey: string } {
  if (col.isPlaceholder) return { text: '—', colorKey: 'dim' };
  switch (col.key) {
    case 'pos':   return { text: fmtV(side.pos,   0), colorKey: side.pos === null ? 'dim' : side.pos > 0 ? 'green' : side.pos < 0 ? 'red' : 'normal' };
    case 'oi':    return { text: fmtV(side.oi,    0), colorKey: 'muted' };
    case 'dOI':   return { text: fmtV(side.dOI,   2), colorKey: side.dOI === null ? 'dim' : side.dOI > 0 ? 'green' : side.dOI < 0 ? 'red' : 'normal' };
    case 'size':  return { text: fmtV(side.size,  0), colorKey: 'muted' };
    case 'ivBid': return { text: fmtIV(side.ivBid), colorKey: 'muted' };
    // 价格类：强制最多 2 位小数
    case 'bid':   return { text: fmt2(side.bid),  colorKey: side.bid !== null ? 'green' : 'dim' };
    case 'mark':  {
      console.log('[getCellValue] side.mark:', side.mark, 'type:', typeof side.mark);
      return { text: fmt2(side.mark), colorKey: 'bright' };
    }
    case 'ask':   return { text: fmt2(side.ask),  colorKey: side.ask !== null ? 'red' : 'dim' };
    case 'ivAsk': return { text: fmtIV(side.ivAsk), colorKey: 'muted' };
    // Greeks：最多 2 位小数；Gamma 固定 5 位小数
    case 'delta': return { text: fmt2(side.delta), colorKey: side.delta > 0 ? 'green' : side.delta < 0 ? 'red' : 'normal' };
    case 'gamma': return { text: fmtGamma5(side.gamma), colorKey: 'purple' };
    case 'vega':  return { text: fmt2(side.vega),  colorKey: 'amber' };
    case 'theta': return { text: fmt2(side.theta), colorKey: 'red' };
    default:      return { text: '—', colorKey: 'dim' };
  }
}

const COLOR_MAP: Record<string, string> = {
  green:  'var(--db-up)',
  red:    'var(--db-down)',
  muted:  'var(--db-muted)',
  bright: 'var(--db-text)',
  dim:    'var(--db-dim)',
  purple: 'var(--db-accent)',
  amber:  'var(--db-warn)',
  normal: 'var(--db-text)',
};

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

const Skeleton = () => (
  <span className="animate-pulse select-none text-[9px] tracking-widest" style={{ color: '#2A2B38' }}>···</span>
);

// ─────────────────────────────────────────────────────────────────────────────
// Single data cell
// ─────────────────────────────────────────────────────────────────────────────

const DataCell = memo(({
  text, colorKey, isRight, loading, dimmed,
}: {
  text: string; colorKey: string; isRight: boolean; loading: boolean; dimmed: boolean;
}) => {
  const color = dimmed && text === '—' ? '#2A2D35' : COLOR_MAP[colorKey] ?? '#EAECEF';
  return (
    <div
      className="db-oc-cell flex items-center h-full"
      style={{ ...TABNUM, justifyContent: isRight ? 'flex-end' : 'flex-start', color }}
    >
      {loading ? <Skeleton /> : text}
    </div>
  );
});
DataCell.displayName = 'DataCell';

const MarkCell = memo(({ mark, iv, dec, loading, dimmed }: {
  mark: number; iv: number; dec: number; loading: boolean; dimmed: boolean;
}) => (
      <div className="db-oc-cell flex flex-col items-end justify-center h-full" style={TABNUM}>
    {loading ? <Skeleton /> : (
      <>
        <span style={{ fontSize: 'var(--db-font-cell)', color: dimmed ? 'var(--db-dim)' : 'var(--db-text)', lineHeight: 1.15 }}>
          {mark.toFixed(2)}
        </span>
        <span style={{ fontSize: 'var(--db-font-sub)', color: dimmed ? 'var(--db-dim)' : 'var(--db-muted)', lineHeight: 1.15 }}>
          {iv.toFixed(1)}%
        </span>
      </>
    )}
  </div>
));
MarkCell.displayName = 'MarkCell';

// ─────────────────────────────────────────────────────────────────────────────
// Chain Row — full 35-column symmetric layout
// ─────────────────────────────────────────────────────────────────────────────

interface SelectedCell { row: ChainRow; side: 'call' | 'put' }

const ChainRowComp = memo(({
  row, cols, loading, dec, isEven, isSelected, onRowClick, showDist, spot, emBandStrikeMin, emBandStrikeMax, variant = 'nexus',
}: {
  row: ChainRow;
  cols: ViewCol[];
  loading: boolean;
  dec: number;
  isEven: boolean;
  isSelected: 'call' | 'put' | 'both' | null;
  onRowClick: (row: ChainRow, side: 'call' | 'put') => void;
  showDist: boolean;
  spot: number;
  emBandStrikeMin: number;
  emBandStrikeMax: number;
  variant?: 'nexus' | 'deribit';
}) => {
  const { call: c, put: p, strike, isATM, isITM } = row;
  console.log('[ChainRowComp] strike:', strike, 'cols.length:', cols.length, 'c.mark:', c.mark);
  const callITM = isITM;
  const putITM  = !isITM && !isATM;

  const stripeBg  = isEven ? BG_ZEBRA : BG_MAIN;
  const callItmBg = callITM ? 'rgba(53,208,127,0.055)' : stripeBg;
  const putItmBg  = putITM  ? 'rgba(255,92,116,0.055)' : stripeBg;

  const selCallBg = 'var(--db-bg-selected)';
  const selPutBg  = 'var(--db-bg-selected)';

  const callBg = (isSelected === 'call' || isSelected === 'both') ? selCallBg : callItmBg;
  const putBg  = (isSelected === 'put'  || isSelected === 'both') ? selPutBg  : putItmBg;

  const callCols  = [...cols].reverse(); // Speed outermost, 持仓 closest to strike
  const putCols   = cols;               // 持仓 closest to strike, Speed outermost
  const colWidths = cols.map(c => `${c.w}px`).join(' ');
  const gridTpl   = `${colWidths} ${STRIKE_W}px ${colWidths}`;
  
  if (strike === 77000) {
    console.log('[ChainRow ATM] colWidths:', colWidths, 'gridTpl:', gridTpl);
  }

  // Distance % from spot price
  const distPct = spot > 0 ? ((strike - spot) / spot) * 100 : 0;
  const distStr = (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%';
  const distColor = distPct > 0 ? 'var(--db-up)' : distPct < 0 ? 'var(--db-down)' : 'var(--db-muted)';
  const strikeText = variant === 'deribit'
    ? strike.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : strike;

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX  = e.clientX - rect.left;
    const callW = cols.reduce((s, c) => s + c.w, 0);
    const side  = relX < callW + STRIKE_W / 2 ? 'call' : 'put';
    onRowClick(row, side);
  }, [row, cols, onRowClick]);

  return (
    <div
      className="db-oc-row group grid"
      style={{
        gridTemplateColumns: gridTpl,
        height: ROW_H,
        cursor: 'pointer',
        borderBottom: `1px solid ${BORDER_C}`,
      }}
      onClick={handleClick}
    >
      {/* ── CALL side (left 17 cols, reversed — 持仓 closest to strike) ── */}
      {callCols.map((col, i) => {
        const { text, colorKey } = getCellValue(c, col, dec);
        const isLast = i === callCols.length - 1;
        return (
          <div
            key={`c-${col.id}-${i}`}
            className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
            style={{
              background: callBg,
              borderRight: isLast ? `1px solid ${BORDER_C}` : undefined,
            }}
          >
            {col.key === 'mark' && !col.isPlaceholder
              ? <MarkCell mark={c.mark} iv={c.iv} dec={dec} loading={loading} dimmed={!callITM && !isATM} />
              : <DataCell text={text} colorKey={colorKey} isRight loading={loading} dimmed={!callITM && !isATM} />
            }
          </div>
        );
      })}

      {/* ── STRIKE center ── */}
      <div
        className="db-oc-strike flex flex-col items-center justify-center transition-[filter] duration-75"
        style={{
          // “透视窗(Window)”只在 1σ 区间内打开：区间内透明以透出胶囊光带，区间外保持默认深色底
          background: (strike >= emBandStrikeMin && strike <= emBandStrikeMax) ? 'transparent' : 'var(--db-bg-strike)',
          borderLeft:  `1px solid ${BORDER_STRONG}`,
          borderRight: `1px solid ${BORDER_STRONG}`,
          position: 'relative',
        }}
      >
        <span
          style={{
            ...TABNUM,
            // ① 执行价列（中间大数字）字体整体减小 2px
            fontSize: variant === 'deribit' ? 14 : 13,
            fontWeight: isATM ? 800 : 700,
            // 执行价数字不做“临近现价”的单独变色高亮：统一保持白色
            color: '#FFFFFF',
            textShadow: 'none',
            lineHeight: showDist ? (variant === 'deribit' ? 1.02 : 1.1) : undefined,
          }}
        >
          {loading ? <Skeleton /> : strikeText}
        </span>
        {isATM && !showDist && null}
        {showDist && (
          <span style={{ ...TABNUM, fontSize: variant === 'deribit' ? 14 : 9.5, color: distColor, lineHeight: variant === 'deribit' ? 1.02 : 1.1 }}>
            {distStr}
          </span>
        )}
      </div>

      {/* ── PUT side (right 17 cols, mirrored — innermost cols closest to strike) ── */}
      {putCols.map((col, i) => {
        const { text, colorKey } = getCellValue(p, col, dec);
        const isFirst = i === 0;
        return (
          <div
            key={`p-${col.id}-${i}`}
            className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
            style={{
              background: putBg,
              borderLeft: isFirst ? `1px solid ${BORDER_C}` : undefined,
            }}
          >
            {col.key === 'mark' && !col.isPlaceholder
              ? <MarkCell mark={p.mark} iv={p.iv} dec={dec} loading={loading} dimmed={!putITM && !isATM} />
              : <DataCell text={text} colorKey={colorKey} isRight loading={loading} dimmed={!putITM && !isATM} />
            }
          </div>
        );
      })}
    </div>
  );
});
ChainRowComp.displayName = 'ChainRowComp';

// ─────────────────────────────────────────────────────────────────────────────
// Order book
// ─────────────────────────────────────────────────────────────────────────────

interface BookLevel { price: number; size: number; iv: number; total: number }

function genBook(bid: number | null, ask: number | null, iv: number, dec: number, seed: number) {
  const rng  = xorRng(seed ^ 0xDEAD);
  const tick = Math.max(Math.pow(10, -dec), 0.0001);
  const asks: BookLevel[] = [];
  let cumAsk = 0, ap = ask ?? (bid ?? 1) * 1.01;
  for (let i = 0; i < 8; i++) {
    const size = parseFloat((rng() * 4 + 0.05).toFixed(2));
    cumAsk += size;
    asks.push({ price: parseFloat((ap + i * tick * (1 + Math.floor(rng() * 4))).toFixed(dec + 1)), size, iv: parseFloat((iv + 0.3 * i + rng() * 0.2).toFixed(1)), total: parseFloat(cumAsk.toFixed(2)) });
  }
  const bids: BookLevel[] = [];
  let cumBid = 0, bp = bid ?? (ask ?? 1) * 0.99;
  for (let i = 0; i < 8; i++) {
    const size = parseFloat((rng() * 4 + 0.05).toFixed(2));
    cumBid += size;
    bids.push({ price: parseFloat((bp - i * tick * (1 + Math.floor(rng() * 4))).toFixed(dec + 1)), size, iv: parseFloat((iv - 0.3 * i - rng() * 0.2).toFixed(1)), total: parseFloat(cumBid.toFixed(2)) });
  }
  return { asks, bids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trading Panel
// ─────────────────────────────────────────────────────────────────────────────

const BORDER = `1px solid ${BORDER_C}`;

const TradingPanel = memo(({
  selected, coinCfg, effectiveSpot, expiryStr, dec, seed, onClose,
}: {
  selected: SelectedCell; coinCfg: CoinCfg; effectiveSpot: number; expiryStr: string; dec: number; seed: number; onClose: () => void;
}) => {
  const { row, side } = selected;
  const opt   = side === 'call' ? row.call : row.put;
  const coin  = coinCfg.label.split(/[\s-]/)[0];
  const contractName = `${coin}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;
  const symbol = `${coin}-${expiryStr.replace(/\s+/g, '')}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;

  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop'>('limit');
  const [quoteMode, setQuoteMode] = useState<'price' | 'iv'>('price');
  const [price,  setPrice]  = useState((opt.ask ?? opt.mark).toFixed(dec));
  const [trigger, setTrigger] = useState((opt.mark).toFixed(dec));
  const [iv,     setIv]     = useState(opt.iv.toFixed(1));
  const [qty,    setQty]    = useState('0.10');
  const [tif,    setTif]    = useState('GTC');
  const [tifOpen, setTifOpen] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [rtab,   setRtab]   = useState<'book' | 'trades' | 'greeks'>('book');
  const [btab,   setBtab]   = useState<'position' | 'open' | 'history' | 'trades'>('position');

  // Trading store
  const placeOrder = useSimTradingStore(s => s.placeOrder);
  const positions = useSimTradingStore(s => s.positions);
  const openOrders = useSimTradingStore(s => s.openOrders);
  const orderHistory = useSimTradingStore(s => s.orderHistory);
  const fills = useSimTradingStore(s => s.fills);

  const { asks, bids } = useMemo(() => {
    if (opt.bid === null && opt.ask === null) {
      return { asks: [], bids: [] };
    }
    return genBook(opt.bid, opt.ask, opt.iv, dec, seed ^ row.strike);
  }, [opt.bid, opt.ask, opt.iv, dec, seed, row.strike]);
  const maxAskTotal = asks[asks.length - 1]?.total ?? 1;
  const maxBidTotal = bids[bids.length - 1]?.total ?? 1;

  const nPrice = useMemo(() => {
    const p = parseFloat((price || '').replace(/,/g, ''));
    return Number.isFinite(p) ? p : 0;
  }, [price]);
  const nQty = useMemo(() => {
    const q = parseFloat((qty || '').replace(/,/g, ''));
    return Number.isFinite(q) ? q : 0;
  }, [qty]);
  const notional = useMemo(() => nPrice * nQty, [nPrice, nQty]);
  const fee = useMemo(() => notional * 0.0005, [notional]);
  const margin = useMemo(() => notional * 0.12, [notional]);
  const totalCost = useMemo(() => notional + fee, [notional, fee]);

  const handleBuy = () => {
    placeOrder({
      side: 'buy',
      type: orderType,
      symbol,
      qty: nQty,
      price: orderType === 'market' ? opt.mark : nPrice,
      iv: quoteMode === 'iv' ? parseFloat(iv) / 100 : undefined,
      tif: tif as any,
      reduceOnly,
      postOnly,
    });
  };

  const handleSell = () => {
    placeOrder({
      side: 'sell',
      type: orderType,
      symbol,
      qty: nQty,
      price: orderType === 'market' ? opt.mark : nPrice,
      iv: quoteMode === 'iv' ? parseFloat(iv) / 100 : undefined,
      tif: tif as any,
      reduceOnly,
      postOnly,
    });
  };

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ backgroundColor: BG_MAIN }}>
      {/* Header: contract + quick stats */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0" style={{ borderBottom: BORDER, backgroundColor: BG_HEADER }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
                <div className="text-[14px] font-extrabold text-white/90 truncate">{contractName}</div>
            <span
              className="text-[10px] font-extrabold px-2 py-[2px] rounded-[999px] shrink-0 border"
              style={{
                borderColor: side === 'call' ? 'rgba(46,189,133,0.30)' : 'rgba(246,70,93,0.30)',
                background: side === 'call' ? 'rgba(46,189,133,0.10)' : 'rgba(246,70,93,0.10)',
                color: side === 'call' ? '#2EBD85' : '#F6465D',
              }}
            >
              {side === 'call' ? 'CALL' : 'PUT'}
            </span>
            <span className="text-[11px] font-mono font-bold text-white/35">·</span>
            <span className="text-[11px] font-mono font-bold text-white/55">{expiryDisplay(expiryStr)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px]">
            {[
              { label: '标记', value: opt.mark.toFixed(dec), color: 'var(--db-text)' },
              { label: 'IV', value: opt.iv.toFixed(1) + '%', color: 'var(--db-warn)' },
              { label: 'Spot', value: effectiveSpot.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'var(--db-muted)' },
              { label: 'Δ', value: opt.delta.toFixed(3), color: opt.delta > 0 ? 'var(--db-up)' : 'var(--db-down)' },
              { label: 'Θ', value: opt.theta.toFixed(4), color: 'var(--db-down)' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className="text-white/35 font-semibold">{item.label}</span>
                <span className="font-mono font-bold" style={{ color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={onClose} className="w-8 h-8 rounded-[10px] border flex items-center justify-center hover:bg-white/[0.06] transition-colors" style={{ borderColor: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.55)' }}>
          <X size={16} />
        </button>
      </div>

      {/* Layout: left order ticket + right panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT: ticket */}
        <div className="flex flex-col shrink-0 border-r overflow-hidden" style={{ width: 320, borderRight: BORDER, backgroundColor: '#0E0F18' }}>
          {/* 顶部：订单类型 + RFQ（更像期权） */}
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2">
              <button
                className="flex-1 h-11 rounded-[12px] border px-3 flex items-center justify-between"
                style={{ borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full border flex items-center justify-center text-[12px] font-extrabold"
                    style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}>i</span>
                  <span className="text-[13px] font-extrabold text-white/85">
                    {orderType === 'limit' ? '限价单' : orderType === 'market' ? '市价单' : '止损单'}
                    {quoteMode === 'iv' ? '/IV' : ''}
                  </span>
                </div>
                <ChevronDown size={16} className="text-white/45" />
              </button>
              <button
                className="h-11 px-3 rounded-[12px] border flex items-center gap-2 font-extrabold text-white/85"
                style={{ borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}
                title="RFQ"
              >
                <span className="w-5 h-5 rounded-[8px] border flex items-center justify-center"
                  style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.70)' }}>◇</span>
                RFQ
              </button>
            </div>
          </div>

          <div className="px-3 pt-3 overflow-auto">
            {/* 合约数量 */}
            <div className="text-[12px] font-semibold text-white/55 mb-1.5">
              合约（1 = 1 {coin}）
              <span className="float-right text-white/45 font-mono font-bold">≈ 0.01 {coin}</span>
            </div>
            <div className="flex items-center rounded-[12px] border"
              style={{ backgroundColor: '#161724', borderColor: 'rgba(255,255,255,0.10)' }}
            >
              <input
                value={qty}
                onChange={e => setQty(e.target.value)}
                className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none"
                style={{ ...TABNUM, color: '#EAECEF' }}
              />
              <div className="px-2 flex flex-col">
                <button className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => (parseFloat(v||'0') + 0.01).toFixed(2))}>▲</button>
                <button className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => Math.max(0.01, parseFloat(v||'0') - 0.01).toFixed(2))}>▼</button>
              </div>
              <div className="px-3 text-[12px] font-bold text-white/60 border-l" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
                合约
              </div>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-white/55">
              可用: <span className="text-white/85 font-mono font-bold">≈ 16,849,985.46 USDC</span>
            </div>

            {/* 报价模式：限价 or IV（高级） */}
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => setQuoteMode('price')}
                className="flex items-center gap-2"
              >
                <span className="w-4 h-4 rounded-full border flex items-center justify-center"
                  style={{ borderColor: quoteMode === 'price' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.20)' }}>
                  {quoteMode === 'price' ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
                </span>
                <span className="text-[13px] font-extrabold text-white/85">限价单</span>
                <div className="ml-auto flex items-center rounded-[10px] border overflow-hidden"
                  style={{ backgroundColor: '#161724', borderColor: 'rgba(255,255,255,0.10)', width: 200 }}
                >
                  <input
                    disabled={quoteMode !== 'price' || orderType === 'market'}
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none disabled:opacity-40"
                    style={{ ...TABNUM, color: '#EAECEF' }}
                  />
                  <span className="px-3 text-[12px] font-bold text-white/45">USDC</span>
                </div>
              </button>

              <button
                onClick={() => setQuoteMode('iv')}
                className="flex items-center gap-2"
              >
                <span className="w-4 h-4 rounded-full border flex items-center justify-center"
                  style={{ borderColor: quoteMode === 'iv' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.20)' }}>
                  {quoteMode === 'iv' ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
                </span>
                <span className="text-[13px] font-extrabold text-white/85">隐含波动率</span>
                <span className="text-[11px] font-extrabold px-2 py-[2px] rounded-full"
                  style={{ background: 'rgba(155,77,255,0.18)', color: 'rgba(200,160,255,0.95)' }}
                >
                  高级
                </span>
                <div className="ml-auto flex items-center rounded-[10px] border overflow-hidden"
                  style={{ backgroundColor: '#161724', borderColor: 'rgba(255,255,255,0.10)', width: 200 }}
                >
                  <input
                    disabled={quoteMode !== 'iv'}
                    value={iv}
                    onChange={e => setIv(e.target.value)}
                    className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none disabled:opacity-40"
                    style={{ ...TABNUM, color: '#EAECEF' }}
                  />
                  <span className="px-3 text-[12px] font-bold text-white/45">IV (%)</span>
                </div>
              </button>
            </div>

            {/* 挂单方式（风格对齐：克制的 pill + 轻描边 + 清晰字重） */}
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.45)' }}>挂单方式</span>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {reduceOnly ? 'Reduce-only' : ''}{reduceOnly && postOnly ? ' · ' : ''}{postOnly ? 'Post-only' : ''}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => setReduceOnly(v => !v)}
                  className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold"
                  style={{
                    borderColor: reduceOnly ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)',
                    background: reduceOnly ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                    color: reduceOnly ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.60)',
                  }}
                >
                  减少
                </button>

                <button
                  onClick={() => setPostOnly(v => !v)}
                  className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold"
                  style={{
                    borderColor: postOnly ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)',
                    background: postOnly ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                    color: postOnly ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.60)',
                  }}
                >
                  挂单
                </button>

                <div className="relative">
                  <button
                    onClick={() => setTifOpen(o => !o)}
                    className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold flex items-center gap-2"
                    style={{
                      borderColor: 'rgba(255,255,255,0.10)',
                      background: 'rgba(255,255,255,0.03)',
                      color: 'rgba(255,255,255,0.75)',
                    }}
                  >
                    {tif} <ChevronDown size={14} className="text-white/45" />
                  </button>
                  <Popover
                    open={tifOpen}
                    onClose={() => setTifOpen(false)}
                    backdropZ={179}
                    panelZ={180}
                    panelClassName="absolute left-0 top-full mt-2 w-[140px] overflow-hidden"
                  >
                    {(['GTC', 'IOC', 'FOK'] as const).map(k => (
                      <button
                        key={k}
                        className="w-full flex items-center justify-between px-3 py-2 text-[12px] hover:bg-white/[0.05] transition-colors"
                        style={{ color: k === tif ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.62)' }}
                        onClick={() => { setTif(k); setTifOpen(false); }}
                      >
                        <span className="font-semibold">{k}</span>
                        {k === tif ? <Check size={14} className="text-white" strokeWidth={3} /> : <span className="opacity-0">.</span>}
                      </button>
                    ))}
                  </Popover>
                </div>
              </div>
            </div>

            {/* 仓位 */}
            <div className="mt-3 inline-flex items-center gap-2">
              <span className="text-[12px] font-extrabold px-2 py-1 rounded-[8px]"
                style={{ background: 'rgba(155,77,255,0.10)', color: 'rgba(155,77,255,0.95)', border: '1px solid rgba(155,77,255,0.18)' }}
              >
                仓位 0.00
              </span>
            </div>

            {/* 买卖 */}
            <div className="mt-3 flex gap-2">
              <button onClick={handleBuy} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all"
                style={{ background: 'rgba(90,196,140,0.92)' }}
              >
                买入
              </button>
              <button onClick={handleSell} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all"
                style={{ background: 'rgba(240,92,104,0.92)' }}
              >
                卖出
              </button>
            </div>

            {/* 保证金（更像期权的买/卖两套） */}
            <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
              <div>
                <div className="text-white/45 font-semibold">购买保证金</div>
                <div className="mt-1 text-white font-mono font-extrabold">{(totalCost).toFixed(2)} USDC</div>
              </div>
              <div className="text-right">
                <div className="text-white/45 font-semibold">卖出保证金</div>
                <div className="mt-1 text-white font-mono font-extrabold">{(margin * 1.8).toFixed(2)} USDC</div>
              </div>
            </div>

            {/* 期权信息 */}
            <div className="mt-4 pt-3 border-t" style={{ borderTop: BORDER }}>
              <div className="grid grid-cols-[1fr_auto] gap-y-2 text-[12px]">
                {[
                  ['标记价格', opt.mark.toFixed(dec)],
                  ['标记价格 IV', `${opt.iv.toFixed(1)}%`],
                  ['价格来源', `${coin} Index`],
                  ['合约大小', `${coin} 1`],
                  ['最小订单规模', `0.01 合同`],
                  ['结算货币', `USDC`],
                  ['到期日', expiryDisplay(expiryStr)],
                ].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <div className="text-white/40 font-semibold">{k}</div>
                    <div className="text-white/80 font-mono font-bold text-right">{v}</div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: (top) book/trades/greeks + (bottom) position/open/history/trades */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* TOP area */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center border-b shrink-0 px-1" style={{ borderBottom: BORDER }}>
              {([{ key: 'book', label: '订单薄' }, { key: 'trades', label: '近期交易' }, { key: 'greeks', label: 'Greeks' }] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setRtab(t.key)}
                  className="px-3 py-2 text-[12px] font-semibold shrink-0"
                  style={{
                    color: rtab === t.key ? '#EAECEF' : 'rgba(255,255,255,0.42)',
                    borderBottom: rtab === t.key ? '2px solid #4A82F7' : '2px solid transparent',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {rtab === 'book' && (
                <div>
                  {asks.length === 0 && bids.length === 0 ? (
                    <div className="flex items-center justify-center h-[200px] text-[13px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      暂无订单簿数据
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_1fr_1fr_1fr] px-2 py-1 border-b text-[11px]" style={{ borderBottom: BORDER, color: '#848E9C' }}>
                        <span className="text-right">总计</span><span className="text-right">数量</span><span className="text-right">IV%</span>
                        <span className="text-right pr-3">买价</span><span className="text-left pl-3">卖价</span>
                        <span className="text-right">IV%</span><span className="text-right">数量</span><span className="text-right">总计</span>
                      </div>
                      {Array.from({ length: Math.max(asks.length, bids.length) }, (_, i) => {
                        const a = asks[i], b = bids[i];
                        return (
                          <div key={i} className="relative grid grid-cols-[1fr_1fr_1fr_auto_auto_1fr_1fr_1fr] px-2 hover:bg-white/[0.03] cursor-pointer" style={{ height: 26 }}>
                            {a && <div className="absolute left-0 top-0 h-full pointer-events-none" style={{ width: `${(a.total / maxAskTotal) * 48}%`, background: 'rgba(246,70,93,0.07)' }} />}
                            {b && <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: `${(b.total / maxBidTotal) * 48}%`, background: 'rgba(46,189,133,0.07)' }} />}
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#848E9C' }}>{a ? a.total.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#EAECEF' }}>{a ? a.size.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ color: '#848E9C' }}>{a ? a.iv.toFixed(1) + '%' : '—'}</span>
                            <span className="text-[12px] font-medium text-right self-center pr-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: '#F6465D' }} onClick={() => a && setPrice(a.price.toFixed(dec))}>{a ? a.price.toFixed(dec) : '—'}</span>
                            <span className="text-[12px] font-medium text-left self-center pl-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: '#2EBD85' }} onClick={() => b && setPrice(b.price.toFixed(dec))}>{b ? b.price.toFixed(dec) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ color: '#848E9C' }}>{b ? b.iv.toFixed(1) + '%' : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#EAECEF' }}>{b ? b.size.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#848E9C' }}>{b ? b.total.toFixed(2) : '—'}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            {rtab === 'greeks' && (
              <div className="p-4 grid grid-cols-2 gap-3">
                {[
                  { label: 'Delta Δ', value: opt.delta.toFixed(4), color: '#2EBD85' },
                  { label: 'Gamma Γ', value: fmtGamma5(opt.gamma), color: '#B068F8' },
                  { label: 'Vega ν',  value: opt.vega.toFixed(4), color: '#F0B90B' },
                  { label: 'Theta Θ',value: opt.theta.toFixed(4), color: '#F6465D' },
                  { label: 'IV',      value: opt.iv.toFixed(2) + '%', color: '#F0B90B' },
                  { label: 'Mark',    value: opt.mark.toFixed(dec), color: '#EAECEF' },
                ].map(g => (
                  <div key={g.label} className="rounded-[6px] p-3" style={{ backgroundColor: '#111118', border: `1px solid ${BORDER_C}` }}>
                    <div className="text-[10px] mb-1" style={{ color: '#848E9C' }}>{g.label}</div>
                    <div className="text-[14px] font-bold" style={{ ...TABNUM, color: g.color }}>{g.value}</div>
                  </div>
                ))}
              </div>
            )}
            {rtab === 'trades' && <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: '#848E9C' }}>近期无成交数据</div>}
            </div>
          </div>

          {/* BOTTOM area (tabs like Deribit) */}
          <div className="shrink-0 border-t flex flex-col" style={{ borderTop: BORDER, backgroundColor: '#0B0C0E', maxHeight: 220 }}>
            <div className="flex items-center gap-3 px-3 h-9 shrink-0">
              {([
                { k: 'position' as const, l: '仓位', c: positions.length },
                { k: 'open' as const, l: '未结订单', c: openOrders.length },
                { k: 'history' as const, l: '订单历史记录', c: orderHistory.length },
                { k: 'trades' as const, l: '交易历史记录', c: fills.length },
              ]).map(t => {
                const on = btab === t.k;
                return (
                  <button
                    key={t.k}
                    onClick={() => setBtab(t.k)}
                    className="text-[12px] font-semibold"
                    style={{ color: on ? '#EAECEF' : 'rgba(255,255,255,0.45)' }}
                  >
                    {t.l} <span style={{ color: on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.30)' }}>{t.c}</span>
                  </button>
                );
              })}
              <div className="flex-1" />
            </div>

            {/* table header */}
            <div className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[11px] border-t shrink-0" style={{ borderTop: BORDER, color: 'rgba(255,255,255,0.35)' }}>
              <div>产品</div>
              <div className="text-right">数量</div>
              <div className="text-right">值</div>
              <div className="text-right">平均价格</div>
              <div className="text-right">标记价格</div>
              <div className="text-right">损益</div>
              <div className="text-right">Δ</div>
            </div>

            {/* content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {btab === 'position' && positions.length === 0 && (
                <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无持仓</div>
              )}
              {btab === 'position' && positions.map(p => (
                <div key={p.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold" style={{ color: p.side === 'long' ? '#5AC48C' : '#F05C68' }}>{p.symbol}</div>
                  <div className="text-right font-mono">{p.qty.toFixed(2)}</div>
                  <div className="text-right font-mono">{(p.markPrice * p.qty).toFixed(2)}</div>
                  <div className="text-right font-mono">{p.avgEntryPrice.toFixed(2)}</div>
                  <div className="text-right font-mono">{p.markPrice.toFixed(2)}</div>
                  <div className="text-right font-mono font-bold" style={{ color: p.unrealizedPnL >= 0 ? '#5AC48C' : '#F05C68' }}>{p.unrealizedPnL >= 0 ? '+' : ''}{p.unrealizedPnL.toFixed(2)}</div>
                  <div className="text-right font-mono">{p.delta.toFixed(3)}</div>
                </div>
              ))}

              {btab === 'open' && openOrders.length === 0 && (
                <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无未结订单</div>
              )}
              {btab === 'open' && openOrders.map(o => (
                <div key={o.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{o.symbol}</div>
                  <div className="text-right font-mono">{o.qty.toFixed(2)}</div>
                  <div className="text-right font-mono">—</div>
                  <div className="text-right font-mono">{o.price.toFixed(2)}</div>
                  <div className="text-right font-mono">—</div>
                  <div className="text-right font-mono" style={{ color: o.side === 'buy' ? '#5AC48C' : '#F05C68' }}>{o.side === 'buy' ? '买入' : '卖出'}</div>
                  <div className="text-right font-mono">{o.type}</div>
                </div>
              ))}

              {btab === 'history' && orderHistory.length === 0 && (
                <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无历史订单</div>
              )}
              {btab === 'history' && orderHistory.slice(-20).reverse().map(o => (
                <div key={o.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{o.symbol}</div>
                  <div className="text-right font-mono">{o.qty.toFixed(2)}</div>
                  <div className="text-right font-mono">—</div>
                  <div className="text-right font-mono">{(o.filledPrice ?? o.price).toFixed(2)}</div>
                  <div className="text-right font-mono">—</div>
                  <div className="text-right font-mono" style={{ color: o.status === 'filled' ? '#5AC48C' : o.status === 'cancelled' ? '#848E9C' : '#F0B90B' }}>
                    {o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已取消' : '待成交'}
                  </div>
                  <div className="text-right font-mono">{new Date(o.createdAt).toLocaleTimeString()}</div>
                </div>
              ))}

              {btab === 'trades' && fills.length === 0 && (
                <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无成交记录</div>
              )}
              {btab === 'trades' && fills.slice(-20).reverse().map(f => (
                <div key={f.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{f.symbol}</div>
                  <div className="text-right font-mono">{f.qty.toFixed(2)}</div>
                  <div className="text-right font-mono">{(f.price * f.qty).toFixed(2)}</div>
                  <div className="text-right font-mono">{f.price.toFixed(2)}</div>
                  <div className="text-right font-mono">{f.fee.toFixed(4)}</div>
                  <div className="text-right font-mono" style={{ color: f.side === 'buy' ? '#5AC48C' : '#F05C68' }}>{f.side === 'buy' ? '买入' : '卖出'}</div>
                  <div className="text-right font-mono">{new Date(f.timestamp).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
TradingPanel.displayName = 'TradingPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Column header row — 3-section symmetric layout with sort icons
// ─────────────────────────────────────────────────────────────────────────────

const SortIcon = ({ active }: { active?: boolean }) => (
  <svg width="8" height="10" viewBox="0 0 8 10" className="ml-0.5 inline-block opacity-50">
    <path d="M4 0L7 4H1L4 0Z" fill={active ? 'var(--db-accent)' : 'var(--db-muted)'} />
    <path d="M4 10L1 6H7L4 10Z" fill={active ? 'var(--db-accent)' : 'var(--db-muted)'} opacity="0.55" />
  </svg>
);

const HeaderCell = memo(({
  col, isActive, onClick, align = 'end', variant = 'nexus',
}: {
  col: ViewCol; isActive: boolean; onClick: () => void; align?: 'start' | 'end';
  variant?: 'nexus' | 'deribit';
}) => (
  <button
    className={cn(
      'flex items-center h-full px-2 transition-colors duration-100 w-full',
      align === 'end' ? 'justify-end' : 'justify-start',
    )}
    onClick={onClick}
  >
    <span
      className="whitespace-nowrap"
      style={{
        fontSize: 'var(--db-font-header)',
        lineHeight: 1,
        fontWeight: 700,
        color: isActive ? 'var(--db-text)' : 'var(--db-muted)',
        textDecorationLine: variant === 'deribit' ? 'underline' : undefined,
        textDecorationStyle: variant === 'deribit' ? 'dotted' : undefined,
        textDecorationColor: variant === 'deribit' ? 'rgba(255,255,255,0.25)' : undefined,
        borderBottom: variant === 'nexus' && isActive ? `1px solid ${GLOW_C}` : '1px solid transparent',
        paddingBottom: variant === 'nexus' ? 1 : 0,
        transition: 'color 0.12s, border-color 0.12s',
      }}
    >
      {col.label}
      <SortIcon active={isActive} />
    </span>
  </button>
));
HeaderCell.displayName = 'HeaderCell';

const ColHeaderRow = memo(({
  cols, sortKey, onSort, variant = 'nexus',
}: {
  cols: ViewCol[];
  sortKey: string | null;
  onSort: (key: string, side: 'call' | 'put') => void;
  variant?: 'nexus' | 'deribit';
}) => {
  const callCols  = [...cols].reverse(); // Speed outermost, 持仓 closest to strike
  const putCols   = cols;               // 持仓 closest to strike, Speed outermost
  const colWidths = cols.map(c => `${c.w}px`).join(' ');
  const gridTpl   = `${colWidths} ${STRIKE_W}px ${colWidths}`;

  return (
    <div style={{ backgroundColor: variant === 'deribit' ? BG_HEADER : BG_MAIN }}>
      {/* Column header row */}
      <div
        className="grid border-b"
        style={{
          gridTemplateColumns: gridTpl,
          height: variant === 'deribit' ? 34 : 36,
          borderBottom: `1px solid ${BORDER_C}`,
        }}
      >
        {/* CALL headers — reversed: Speed outermost, 持仓 closest to strike */}
        {callCols.map((col, i) => (
          <div
            key={`hc-${col.id}-${i}`}
            style={{
              borderRight: i === callCols.length - 1 ? `1px solid ${BORDER_C}` : undefined,
              height: '100%',
            }}
          >
            <HeaderCell
              col={col}
              isActive={sortKey === `call-${col.id}`}
              onClick={() => onSort(`call-${col.id}`, 'call')}
              align="end"
              variant={variant}
            />
          </div>
        ))}

        {/* STRIKE center header */}
        <div
          className="flex flex-col items-center justify-center"
          style={{
            background: 'var(--db-bg-strike)',
            borderLeft:  `1px solid ${BORDER_STRONG}`,
            borderRight: `1px solid ${BORDER_STRONG}`,
            position: 'relative',
            zIndex: 2,
          }}
        >
          {variant === 'deribit'
            ? (
              // ② 中间列标题：显示“执行”
              <span
                className="text-[16px] font-bold"
                style={{
                  color: 'var(--db-muted)',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'rgba(255,255,255,0.28)',
                  textUnderlineOffset: 3,
                }}
              >
                执行
              </span>
            )
            : (
              <>
                <span className="text-[13px] font-bold" style={{ color: '#FFFFFF' }}>执行价</span>
              </>
            )
          }
        </div>

        {/* PUT headers — right-aligned to match data cells */}
        {putCols.map((col, i) => (
          <div
            key={`hp-${col.id}-${i}`}
            style={{
              borderLeft: i === 0 ? `1px solid ${BORDER_C}` : undefined,
              height: '100%',
            }}
          >
            <HeaderCell
              col={col}
              isActive={sortKey === `put-${col.id}`}
              onClick={() => onSort(`put-${col.id}`, 'put')}
              align="end"
              variant={variant}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
ColHeaderRow.displayName = 'ColHeaderRow';

// ─────────────────────────────────────────────────────────────────────────────
// Section row — CALLS label | spot/expiry info | PUTS label
// ─────────────────────────────────────────────────────────────────────────────

const SectionRow = memo(({
  coinCfg, effectiveSpot, expiryStr, atmIV, spotDp, dte, callSideWidth, emLower, emUpper, variant = 'nexus',
}: {
  coinCfg: CoinCfg; effectiveSpot: number; expiryStr: string; atmIV: number; spotDp: number; dte: string;
  callSideWidth: number;
  emLower?: number;
  emUpper?: number;
  variant?: 'nexus' | 'deribit';
}) => (
  <div
    className="flex items-center border-b shrink-0 relative"
    style={{ height: 36, borderBottom: `1px solid ${BORDER_C}`, backgroundColor: variant === 'deribit' ? BG_HEADER : BG_MAIN }}
  >
    {/* Left */}
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: callSideWidth, height: '100%' }}
    >
      <div className="absolute left-3">
        <button
          className="flex items-center gap-1 h-[20px] px-2 rounded-[6px] border text-[12px] font-bold"
          style={{
            backgroundColor: 'rgba(47,107,255,0.10)',
            borderColor: 'rgba(47,107,255,0.55)',
            color: 'rgba(138,181,255,0.95)',
          }}
        >
          <Download size={14} /> CSV
        </button>
      </div>
      <span
        className="font-bold"
        style={{
          color: 'var(--db-text)',
          fontSize: variant === 'deribit' ? 16 : 10,
          letterSpacing: variant === 'deribit' ? '-0.01em' : '0.16em',
        }}
      >
        看涨期权
      </span>
    </div>

    {/* Strike col spacer */}
    <div className="shrink-0" style={{ width: STRIKE_W }} />

    {/* Right */}
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: callSideWidth, height: '100%' }}
    >
      <span
        className="font-bold"
        style={{
          color: 'var(--db-text)',
          fontSize: variant === 'deribit' ? 16 : 10,
          letterSpacing: variant === 'deribit' ? '-0.01em' : '0.16em',
        }}
      >
        看跌期权
      </span>
      {/* IV badge (hover shows Deribit-style explanation card) */}
      <IVBadge
        variant={variant}
        atmIV={atmIV}
        spot={effectiveSpot}
        spotDp={spotDp}
        emLower={emLower}
        emUpper={emUpper}
      />
    </div>

    {/* Date — pinned exactly above the strike column center */}
    <div
      className="flex items-center justify-center pointer-events-none"
      style={{ position: 'absolute', top: 0, bottom: 0, left: callSideWidth, width: STRIKE_W }}
    >
      <span
        className="whitespace-nowrap"
        style={{
          ...TABNUM,
          // ③ 日期（10 May 2026）字体 +2px
          fontSize: variant === 'deribit' ? 18 : 13,
          fontWeight: variant === 'deribit' ? 800 : 700,
          color: 'var(--db-text)',
          letterSpacing: variant === 'deribit' ? '-0.01em' : undefined,
        }}
      >
        {expiryDisplay(expiryStr)}
      </span>
    </div>

    {/* 标的价格 — right-aligned, ending before the strike column */}
    <div
      className="flex items-center justify-end pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        // ①/②/③：保证左右间距一致（标记 ↔ 日期 ↔ 到期时间）
        width: callSideWidth - (variant === 'deribit' ? 54 : 24),
      }}
    >
      <span
        className="whitespace-nowrap"
        style={{
          color: 'var(--db-muted)',
          fontSize: variant === 'deribit' ? 13 : 11,
          fontWeight: variant === 'deribit' ? 600 : 500,
        }}
      >
        标记:{' '}
        <span
          style={{
            color: 'var(--db-text)',
            textDecoration: variant === 'deribit' ? 'underline' : undefined,
            textDecorationStyle: variant === 'deribit' ? 'dotted' : undefined,
            textDecorationColor: variant === 'deribit' ? 'rgba(255,255,255,0.25)' : undefined,
          }}
        >
          ($){effectiveSpot.toLocaleString('en-US', { minimumFractionDigits: spotDp, maximumFractionDigits: spotDp })}
        </span>
      </span>
    </div>

    {/* 到期时间 — left-aligned, starting after the strike column */}
    <div
      className="flex items-center pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        // ①/②/③：保证左右间距一致（标记 ↔ 日期 ↔ 到期时间）
        left: callSideWidth + STRIKE_W + (variant === 'deribit' ? 54 : 24),
      }}
    >
      <span
        className="whitespace-nowrap"
        style={{
          color: 'var(--db-muted)',
          fontSize: variant === 'deribit' ? 13 : 11,
          fontWeight: variant === 'deribit' ? 600 : 500,
        }}
      >
        到期时间:{' '}
        <span style={{ color: 'var(--db-text)' }}>{dte}</span>
      </span>
    </div>
  </div>
));

const IVBadge = ({
  variant,
  atmIV,
  spot,
  spotDp,
  emLower,
  emUpper,
}: {
  variant: 'nexus' | 'deribit';
  atmIV: number;
  spot: number;
  spotDp: number;
  emLower?: number;
  emUpper?: number;
}) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deltas = useMemo(() => {
    if (typeof emLower !== 'number' || typeof emUpper !== 'number') return null;
    const down = Math.round(emLower - spot); // negative
    const up = Math.round(emUpper - spot);   // positive
    return { down, up };
  }, [emLower, emUpper, spot]);

  const onEnter = () => {
    if (variant !== 'deribit') return;
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };
  const onLeave = () => {
    if (variant !== 'deribit') return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className="absolute right-3" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span className="db-iv-trigger whitespace-nowrap">
        IV:{' '}
        <span className="db-iv-value">
          {atmIV.toFixed(1)}%
        </span>
      </span>

      <HoverPopover
        open={open}
        panelZ={80}
        panelClassName="absolute top-full right-0 mt-2 w-[380px]"
      >
        <div className="p-3" style={{ fontSize: 13, lineHeight: 1.55 }}>
          <div className="font-bold text-white/90">
            IV:{' '}
            <span className="db-iv-value">
              {atmIV.toFixed(1)}%
            </span>
            {deltas ? (
              <span className="text-white/65 font-mono font-semibold ml-2">
                ({deltas.down.toLocaleString('en-US')}, +{deltas.up.toLocaleString('en-US')})
              </span>
            ) : null}
          </div>

          <div className="mt-2 text-white/78 font-semibold">
            标准差预计变动量，由当前虚值期权的价格推导出。预计的变动提供了期权价格暗示的价格区间，这个价格区间在期权到期时最可能*包含标的资产价格。
          </div>
          <div className="mt-2 text-white/70 font-semibold">
            *基于一个标准差，大约68%的时间。
          </div>

          <div className="mt-3 text-white/70 font-semibold">
            预期的区间低点由以下值给出：
          </div>
          <div className="mt-1 font-mono text-white/85 font-semibold">
            未来 / (exp(ATM_Vol * sqrt(T)))
          </div>
          <div className="mt-2 text-white/70 font-semibold">
            预期的区间高点由以下值给出：
          </div>
          <div className="mt-1 font-mono text-white/85 font-semibold">
            未来 * (exp(ATM_Vol * sqrt(T)))
          </div>

          <div className="mt-3 text-white/35 font-mono">
            spot: {spot.toLocaleString('en-US', { minimumFractionDigits: spotDp, maximumFractionDigits: spotDp })}
          </div>
        </div>
      </HoverPopover>
    </div>
  );
};
SectionRow.displayName = 'SectionRow';

// ─────────────────────────────────────────────────────────────────────────────
// Filter / toolbar helpers
// ─────────────────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'atm5' | 'atm10';
const FILTER_OPTS: { key: FilterKey; label: string }[] = [
  { key: 'all',   label: '全部行权价' },
  { key: 'atm5',  label: 'ATM ±5 档' },
  { key: 'atm10', label: 'ATM ±10 档' },
];

const FilterBtn = ({ active, onChange }: { active: FilterKey; onChange: (k: FilterKey) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[4px] border text-[12px] font-medium transition-colors duration-100"
        style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderColor: '#2B3139', color: '#848E9C' }}
      >
        <Filter size={10} style={{ fill: 'currentColor' }} />
        过滤
        {active !== 'all' && <span className="w-1.5 h-1.5 rounded-full ml-0.5" style={{ background: '#4A82F7' }} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 rounded-[8px] border overflow-hidden shadow-lg min-w-[160px]" style={{ backgroundColor: '#14151E', borderColor: '#2B3139' }}>
            {FILTER_OPTS.map(opt => (
              <button key={opt.key} onClick={() => { onChange(opt.key); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left hover:bg-white/[0.05] transition-colors duration-100">
                <span className="w-[13px] h-[13px] rounded-[2px] border flex items-center justify-center shrink-0" style={{ background: active === opt.key ? '#4A82F7' : 'transparent', borderColor: active === opt.key ? '#4A82F7' : '#848E9C' }}>
                  {active === opt.key && <Check size={8} className="text-white" strokeWidth={3} />}
                </span>
                <span style={{ color: active === opt.key ? '#EAECEF' : '#848E9C' }}>{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const ToolBtn = ({ icon, label, active, onClick }: { icon?: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[4px] border text-[12px] font-medium transition-colors duration-100"
    style={{
      backgroundColor: active ? 'var(--db-accent-weak)' : 'rgba(255,255,255,0.03)',
      borderColor: active ? 'var(--db-accent-soft)' : 'var(--db-border)',
      color: active ? 'var(--db-accent)' : 'var(--db-muted)',
    }}
  >
    {icon}{label}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export type OptionsChainMode = 'nexus' | 'deribit';

export const DERIBIT_EXPIRIES = [
  '19 MAY 26','20 MAY 26','21 MAY 26','22 MAY 26','29 MAY 26',
  '5 JUN 26','26 JUN 26','31 JUL 26','25 SEP 26','25 DEC 26','26 MAR 27',
] as const;

export default function OptionsChainPage({
  mode = 'nexus',
  hideHeader = false,
}: {
  mode?: OptionsChainMode;
  hideHeader?: boolean;
} = {}) {
  console.log('[OptionsChainPage] Rendered, mode:', mode);
  
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const isDeribit = mode === 'deribit';

  const urlCoinId    = params.get('coin')   ?? 'BTC-USD';
  const urlExpiryStr = params.get('expiry') ?? DERIBIT_EXPIRIES[0];

  const optionsChainTabs      = useWorkspaceStore(s => s.optionsChainTabs);
  const activeOptionsTabId    = useWorkspaceStore(s => s.activeOptionsTabId);
  const openOptionsChainTab   = useWorkspaceStore(s => s.openOptionsChainTab);
  const removeOptionsChainTab = useWorkspaceStore(s => s.removeOptionsChainTab);
  const setActiveOptionsTab   = useWorkspaceStore(s => s.setActiveOptionsTab);
  const updateOptionsChainTab = useWorkspaceStore(s => s.updateOptionsChainTab);
  const openComponentLibrary  = useWorkspaceStore(s => s.openComponentLibrary);

  // 注意：不要在 activeOptionsTabId=null 时 fallback 到 tabs[0]，否则 append 新 tab 时会“看起来像替换当前 tab”
  const activeTab = activeOptionsTabId
    ? (optionsChainTabs.find(t => t.id === activeOptionsTabId) ?? null)
    : null;

  // 等待 zustand persist rehydrate 完成，避免 URL→store 的 open 被旧持久化状态覆盖
  const [hydrated, setHydrated] = useState(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (useWorkspaceStore as any).persist;
    return typeof p?.hasHydrated === 'function' ? !!p.hasHydrated() : true;
  });
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (useWorkspaceStore as any).persist;
    if (!p) return;
    if (typeof p.hasHydrated === 'function' && p.hasHydrated()) setHydrated(true);
    const unsub = typeof p.onFinishHydration === 'function'
      ? p.onFinishHydration(() => setHydrated(true))
      : undefined;
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // 标记“本次 active 变化来自 URL 同步”，避免 store→URL 反向覆盖 URL（造成看起来像“替换当前Tab”）
  const syncingFromUrlRef = useRef(false);
  // 关闭 Tab 属于“本地 UI 行为”，应阻止 URL→store 立即把被关闭的 Tab 再打开
  const suppressUrlSyncOnceRef = useRef(false);

  // hydration 后自愈：若持久化里 tab 存在但 active 丢失，补回一个 active，避免后续出现 fallback 行为
  useEffect(() => {
    if (!hydrated) return;
    if (optionsChainTabs.length > 0 && !activeOptionsTabId) {
      setActiveOptionsTab(optionsChainTabs[optionsChainTabs.length - 1]!.id);
    }
  }, [hydrated, optionsChainTabs, activeOptionsTabId, setActiveOptionsTab]);

  // 允许关闭最后一个 Tab：当本页所有 Tab 被关闭时，退出期权链页面并跳转到「监控」
  useEffect(() => {
    if (!hydrated) return;
    if (optionsChainTabs.length > 0) return;
    // 避免 URL→store 把刚关闭的 Tab 又同步回来
    suppressUrlSyncOnceRef.current = true;
    navigate('/monitor', { replace: true });
  }, [hydrated, optionsChainTabs.length, navigate]);

  const activateTab = useCallback((tabId: string) => {
    // 用户点击切换 Tab：应由 store→URL 同步 URL；避免 URL→store 抢先把 active 复原
    suppressUrlSyncOnceRef.current = true;
    setActiveOptionsTab(tabId);
  }, [setActiveOptionsTab]);

  // URL → store：只在 hydration 完成后，并且与当前 activeTab 不一致时才 open/激活
  useLayoutEffect(() => {
    if (!hydrated) return;
    if (suppressUrlSyncOnceRef.current) {
      suppressUrlSyncOnceRef.current = false;
      return;
    }
    if (activeTab?.coinId === urlCoinId && activeTab?.expiry === urlExpiryStr) return;
    syncingFromUrlRef.current = true;
    openOptionsChainTab(urlCoinId, urlExpiryStr);
  }, [hydrated, urlCoinId, urlExpiryStr, activeTab?.coinId, activeTab?.expiry, openOptionsChainTab]);

  const coinId    = activeTab?.coinId   ?? urlCoinId;
  const expiryStr = activeTab?.expiry   ?? urlExpiryStr;
  const coinCfg   = COIN_CFG[coinId] ?? COIN_CFG['BTC-USD'];

  // 连接 Deribit 实时行情 WebSocket（根据当前选择的币种和到期日动态订阅）
  const { underlyingPrice } = useDeribitOptionsStream(coinCfg.label, expiryStr, true);
  
  // 使用 Deribit 实时价格覆盖硬编码的 spot 价格
  const effectiveSpot = underlyingPrice ?? coinCfg.spot;
  
  // 获取真实持仓数据
  const positions = useSimTradingStore(s => s.positions);
  const storeTickers = useSimTradingStore(s => s.tickers);

  // store(activeTab) → URL：只有用户切换 Tab 时才同步 URL（replace，避免历史栈膨胀）
  useEffect(() => {
    if (!activeTab) return;
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      return;
    }
    if (urlCoinId === activeTab.coinId && urlExpiryStr === activeTab.expiry) return;
    navigate(
      `/options-chain?coin=${encodeURIComponent(activeTab.coinId)}&expiry=${encodeURIComponent(activeTab.expiry)}`,
      { replace: true }
    );
  }, [activeTab?.id, activeTab?.coinId, activeTab?.expiry, urlCoinId, urlExpiryStr, navigate]);

  // 追加 Tab 后自动滚到最右：仅当 tabs 数量增加且 active 没变时触发（避免切换 tab 时扰动）
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const prevTabsMetaRef = useRef<{ len: number; active: string | null }>({ len: 0, active: null });
  useEffect(() => {
    const prev = prevTabsMetaRef.current;
    const len = optionsChainTabs.length;
    if (len > prev.len && activeOptionsTabId === prev.active) {
      requestAnimationFrame(() => {
        const el = tabScrollRef.current;
        if (!el) return;
        el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
      });
    }
    prevTabsMetaRef.current = { len, active: activeOptionsTabId };
  }, [optionsChainTabs.length, activeOptionsTabId]);

  // 顶部 Tabs 的“滑块 underline”定位（用于 Nexus 样式 tab bar）
  const tabBtnRefs = useRef(new Map<string, HTMLButtonElement>());
  const derivedActiveTabId = useMemo(() => {
    if (activeOptionsTabId) return activeOptionsTabId;
    return (
      optionsChainTabs.find(t => t.coinId === urlCoinId && t.expiry === urlExpiryStr)?.id ??
      optionsChainTabs[0]?.id ??
      null
    );
  }, [activeOptionsTabId, optionsChainTabs, urlCoinId, urlExpiryStr]);
  const [underline, setUnderline] = useState<{ left: number; width: number; opacity: number }>({
    left: 0,
    width: 0,
    opacity: 0,
  });
  const recalcUnderline = useCallback(() => {
    const id = derivedActiveTabId;
    const wrap = tabScrollRef.current;
    if (!id || !wrap) {
      setUnderline(prev => ({ ...prev, opacity: 0 }));
      return;
    }
    const el = tabBtnRefs.current.get(id);
    if (!el) return;
    const wrapRect = wrap.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // 用 rect 计算（避免 offsetParent 导致 offsetLeft 恒为 0，从而“滑块不移动”）
    const rawLeft = elRect.left - wrapRect.left + wrap.scrollLeft;
    // underline 只覆盖“标题文字”区域，略去两侧 padding（与截图一致）
    setUnderline({
      left: rawLeft + 8,
      width: Math.max(24, elRect.width - 16),
      opacity: 1,
    });
  }, [derivedActiveTabId]);

  // 计算 underline：useLayoutEffect + rAF（避免字体/过渡导致的“看起来不移动”）
  useLayoutEffect(() => {
    recalcUnderline();
    const raf = requestAnimationFrame(recalcUnderline);
    return () => cancelAnimationFrame(raf);
  }, [recalcUnderline, optionsChainTabs.length]);

  // resize 时重新测量（字体大小/容器宽度变化）
  useEffect(() => {
    const onResize = () => recalcUnderline();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [recalcUnderline]);

  const closeTab = useCallback((tabId: string) => {
    suppressUrlSyncOnceRef.current = true;
    removeOptionsChainTab(tabId);
  }, [removeOptionsChainTab]);

  // 在“当前激活 Tab 内”切换到期日（不会新增 Tab）
  const changeActiveTabExpiry = useCallback((nextExpiry: string) => {
    const tabId = derivedActiveTabId;
    if (!tabId) return;
    const current = optionsChainTabs.find(t => t.id === tabId) ?? null;
    if (!current) return;

    // 目标到期日已存在其它 Tab：直接切过去，并关闭当前 Tab（避免重复 Tab）
    const existing = optionsChainTabs.find(t => t.id !== tabId && t.coinId === current.coinId && t.expiry === nextExpiry);
    suppressUrlSyncOnceRef.current = true;
    if (existing) {
      setActiveOptionsTab(existing.id);
      removeOptionsChainTab(tabId);
      return;
    }
    updateOptionsChainTab(tabId, { expiry: nextExpiry });
  }, [derivedActiveTabId, optionsChainTabs, setActiveOptionsTab, removeOptionsChainTab, updateOptionsChainTab]);

  const T    = useMemo(() => expiryT(expiryStr), [expiryStr]);
  const seed = useMemo(() => {
    const s = coinId + expiryStr;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h;
  }, [coinId, expiryStr]);

  const [isLoading,    setIsLoading]    = useState(false);
  const [filterKey,    setFilterKey]    = useState<FilterKey>('all');
  const [sortKey,      setSortKey]      = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [autoHeight,   setAutoHeight]   = useState(false);
  const [showDist,     setShowDist]     = useState(false);
  const [expiryOpen,   setExpiryOpen]   = useState(false);
  const [columnsOpen,  setColumnsOpen]  = useState(false);
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [visibleColIds, setVisibleColIds] = useState<Set<string>>(
    () => new Set(ALL_17_COLS.map(c => c.id))
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTitleHover, setIsTitleHover] = useState(false);

  const cols = useMemo<ViewCol[]>(() => {
    if (!isDeribit) return ALL_17_COLS;
    return ALL_17_COLS.filter(c => visibleColIds.has(c.id));
  }, [isDeribit, visibleColIds]);

  // Fetch live expiries from Deribit
  const [liveExpiries, setLiveExpiries] = useState<string[]>([]);
  useEffect(() => {
    const base = coinCfg.label;
    let cancelled = false;
    (async () => {
      try {
        console.log('[Deribit API] Fetching instruments for', base);
        const res = await fetch(
          `https://www.deribit.com/api/v2/public/get_instruments?currency=${base}&kind=option&expired=false`
        );
        const json = await res.json();
        if (cancelled) return;
        console.log('[Deribit API] Response:', json?.result?.length, 'instruments');
        if (json?.result) {
          const expSet = new Set<string>();
          for (const inst of json.result) {
            const name = inst.instrument_name;
            const parts = name.split('-');
            if (parts.length >= 3) {
              const rawExpiry = parts[1];
              const formatted = rawExpiry.replace(/(\d+)([A-Z]{3})(\d{2})/, '$1 $2 $3');
              expSet.add(formatted);
            }
          }
          const sorted = [...expSet].sort((a, b) => {
            const parseDate = (s: string) => {
              const [d, m, y] = s.split(' ');
              const months: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
              return new Date(2000 + parseInt(y), months[m] ?? 0, parseInt(d)).getTime();
            };
            return parseDate(a) - parseDate(b);
          });
          console.log('[Deribit API] Live expiries:', sorted);
          setLiveExpiries(sorted);
        }
      } catch (e) {
        console.error('[Deribit API] Failed to fetch instruments:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [coinCfg.label]);

  const expiries = liveExpiries.length > 0 ? liveExpiries : DERIBIT_EXPIRIES;

  // Auto-switch to first available expiry if current one is not in live list
  useEffect(() => {
    if (liveExpiries.length === 0) return;
    if (liveExpiries.includes(expiryStr)) return;
    changeActiveTabExpiry(liveExpiries[0]);
  }, [liveExpiries, expiryStr, changeActiveTabExpiry]);

  const allRows = useMemo(() => {
    const baseCoin = coinCfg.label;
    const expiryPrefix = expiryStr.replace(/\s+/g, '').toUpperCase();

    // Collect live strikes from store tickers for current expiry
    const liveStrikes = new Map<number, { call?: any; put?: any }>();
    const T = expiryT(expiryStr);
    const spot = effectiveSpot;
    
    for (const [symbol, ticker] of Object.entries(storeTickers)) {
      const match = symbol.match(/^([A-Z]+)(?:_USDC)?-([A-Z0-9]+)-(\d+(?:\.\d+)?)-([CP])$/);
      if (!match) continue;
      
      const [, coin, expiry, strikeStr, type] = match;
      
      if (coin !== baseCoin) continue;
      if (expiry !== expiryPrefix) continue;
      
      const strike = parseFloat(strikeStr);
      if (Number.isFinite(strike) && ticker?.markPrice > 0) {
        if (!liveStrikes.has(strike)) liveStrikes.set(strike, {});
        const entry = liveStrikes.get(strike)!;
        
        // Deribit REST 不返回希腊字母，用 Black-Scholes 计算
        const iv = ticker.iv ?? 0; // 已经是小数形式 (e.g. 0.3887)
        const delta = iv > 0 ? bsDelta(spot, strike, T, iv, type === 'C') : 0;
        const gamma = iv > 0 ? bsGamma(spot, strike, T, iv) : 0;
        const vega = iv > 0 ? bsVega(spot, strike, T, iv) : 0;
        const theta = iv > 0 ? bsTheta(spot, strike, T, iv, type === 'C') : 0;
        
        const data = {
          bid: ticker.bid != null ? ticker.bid : null,
          ask: ticker.ask != null ? ticker.ask : null,
          mark: ticker.markPrice,
          iv: iv * 100, // 转换为百分比显示
          ivBid: null,
          ivAsk: null,
          delta,
          gamma,
          vega,
          theta,
          oi: Number.isFinite(ticker.oi) ? ticker.oi : null,
          dOI: null,
          size: Number.isFinite(ticker.volume) ? ticker.volume : null,
          pos: null,
        };
        if (type === 'C') entry.call = data;
        else entry.put = data;
      }
    }

    // If we have live data, build rows from it
    if (liveStrikes.size > 0) {
      const strikes = [...liveStrikes.keys()].sort((a, b) => a - b);
      // Find ATM strike (where call and put prices are closest)
      let atmK = strikes[0];
      let minDiff = Infinity;
      for (const k of strikes) {
        const entry = liveStrikes.get(k)!;
        if (entry.call?.mark && entry.put?.mark) {
          const diff = Math.abs(entry.call.mark - entry.put.mark);
          if (diff < minDiff) {
            minDiff = diff;
            atmK = k;
          }
        }
      }

      // Use ATM strike as spot price approximation
      const effectiveSpot = atmK;

      const rows = strikes.map(K => {
        const entry = liveStrikes.get(K)!;
        return {
          strike: K,
          isATM: K === atmK,
          isITM: K < effectiveSpot,
          call: entry.call ?? buildEmptySide(),
          put: entry.put ?? buildEmptySide(),
        };
      });
      
      console.log('[Chain Data] Using LIVE data, rows:', rows.length);
      return rows;
  }

  // No live data, return empty array
  console.log('[Chain Data] No live data for', expiryPrefix);
  return [];
}, [coinCfg, T, seed, storeTickers, expiryStr, effectiveSpot]);
  const rows = useMemo(() => {
    const filtered = filterKey === 'all' ? allRows : (() => {
      const ai = allRows.findIndex(r => r.isATM);
      const n  = filterKey === 'atm5' ? 5 : 10;
      return allRows.slice(Math.max(0, ai - n), ai + n + 1);
    })();

    // 注入真实持仓数据
    const baseCoin = coinCfg.label;
    const expiryPrefix = expiryStr.replace(/\s+/g, '').toUpperCase();
    
    return filtered.map(row => {
      // 支持两种格式：BTC-21MAY26-77000-C 和 BTC_USDC-19MAY26-70000-C
      const callSymbol = `${baseCoin}-${expiryPrefix}-${row.strike}-C`;
      const putSymbol = `${baseCoin}-${expiryPrefix}-${row.strike}-P`;
      const callSymbolUsdc = `${baseCoin}_USDC-${expiryPrefix}-${row.strike}-C`;
      const putSymbolUsdc = `${baseCoin}_USDC-${expiryPrefix}-${row.strike}-P`;
      
      const callPos = positions.find(p => p.symbol === callSymbol || p.symbol === callSymbolUsdc);
      const putPos = positions.find(p => p.symbol === putSymbol || p.symbol === putSymbolUsdc);
      
      return {
        ...row,
        call: {
          ...row.call,
          pos: callPos ? (callPos.side === 'long' ? callPos.qty : -callPos.qty) : null,
        },
        put: {
          ...row.put,
          pos: putPos ? (putPos.side === 'long' ? putPos.qty : -putPos.qty) : null,
        },
      };
    });
  }, [allRows, filterKey, positions, coinCfg.label, expiryStr]);

  const handleFilter = useCallback((k: FilterKey) => {
    if (k === filterKey) return;
    setIsLoading(true);
    setTimeout(() => { setFilterKey(k); setIsLoading(false); }, 350);
  }, [filterKey]);

  const handleRowClick = useCallback((row: ChainRow, side: 'call' | 'put') => {
    setSelectedCell(prev => prev?.row.strike === row.strike && prev?.side === side ? null : { row, side });
  }, []);

  useEffect(() => {
    if (!selectedCell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedCell(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCell]);

  const atmRow = allRows.find(r => r.isATM);
  const atmIV  = atmRow?.call.iv ?? 48;
  const dec    = effectiveSpot < 1 ? 6 : effectiveSpot < 100 ? 4 : 2;
  const spotDp = effectiveSpot < 1 ? 6 : effectiveSpot < 100 ? 4 : 2;
  const dte    = useMemo(() => expiryDTE(expiryStr), [expiryStr]);

  // Total content width: 17 cols * 2 + strike
  const colsWidth  = cols.reduce((s, c) => s + c.w, 0);
  const totalWidth = colsWidth * 2 + STRIKE_W;

  // ±1σ expected move bounds (in price and in Y-pixel)
  const dteDays = useMemo(() => {
    const [d, m, y] = expiryStr.split(' ');
    const ms = new Date(2000 + parseInt(y), MON[m] ?? 0, parseInt(d)).getTime() - Date.now();
    return Math.max(ms / (1000 * 3600 * 24), 0);
  }, [expiryStr]);

  const { emLower, emUpper } = useMemo(() => {
    const em = effectiveSpot * (atmIV / 100) * Math.sqrt(dteDays / 365);
    return { emLower: effectiveSpot - em, emUpper: effectiveSpot + em };
  }, [effectiveSpot, atmIV, dteDays]);

  // Map price → Y coordinate in virtualised list
  const priceToY = useCallback((price: number): number => {
    if (rows.length === 0) return 0;
    if (price <= rows[0].strike) return 0;
    if (price >= rows[rows.length - 1].strike) return rows.length * ROW_H;
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].strike <= price && price <= rows[i + 1].strike) {
        const frac = (price - rows[i].strike) / (rows[i + 1].strike - rows[i].strike);
        return (i + frac) * ROW_H;
      }
    }
    return rows.length * ROW_H;
  }, [rows]);

  // 1σ 区间：为了“胶囊阶段感”更干净，强制吸附到行的物理边界（整行覆盖）
  const { emBandTop, emBandHeight, emBandStrikeMin, emBandStrikeMax } = useMemo(() => {
    const strikes = rows.map(r => r.strike);
    const rowHeight = ROW_H;
    if (strikes.length === 0) {
      return { emBandTop: 0, emBandHeight: 0, emBandStrikeMin: -Infinity, emBandStrikeMax: Infinity };
    }
    const low = Math.min(emLower, emUpper);
    const high = Math.max(emLower, emUpper);
    let startIdx = strikes.findIndex(s => s >= low);
    if (startIdx < 0) startIdx = strikes.length - 1;
    let endIdx = strikes.findIndex(s => s >= high);
    if (endIdx < 0) endIdx = strikes.length - 1;
    if (endIdx < startIdx) [startIdx, endIdx] = [endIdx, startIdx];
    const top = startIdx * rowHeight;
    const height = (endIdx - startIdx + 1) * rowHeight;
    return {
      emBandTop: top,
      emBandHeight: height,
      emBandStrikeMin: strikes[startIdx],
      emBandStrikeMax: strikes[endIdx],
    };
  }, [rows, emLower, emUpper]);

  // Strike column x-offset (left edge)
  const strikeX = colsWidth;

  // Deribit visuals: UI blue + spot/strike purple
  const spotAccent = isDeribit ? 'var(--db-spot)' : 'var(--db-accent)';
  const emBandBg = isDeribit
    ? 'linear-gradient(180deg, var(--db-spot-weak), rgba(155,77,255,0.06))'
    : 'linear-gradient(180deg, var(--db-accent-weak), rgba(61,125,255,0.06))';
  const emBandBorder = isDeribit ? 'rgba(155,77,255,0.35)' : 'rgba(61,125,255,0.35)';

  // Spot Y：严格线性插值（以“行中心点”为基准），确保落在两行文字的空白间隙
  const spotY = useMemo(() => {
    const currentPrice = effectiveSpot;
    const strikes = rows.map(r => r.strike);
    const rowHeight = ROW_H;

    const upperIndex = strikes.findIndex(s => s >= currentPrice);
    if (upperIndex <= 0) return rowHeight / 2;

    // 直接返回上下两行之间的【物理缝隙坐标】（上面那一行的底边缘）
    return upperIndex * rowHeight;
  }, [rows, effectiveSpot]);
  const currentPrice = effectiveSpot;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
  });

  console.log('[Virtualizer] rows.length:', rows.length, 'virtual items:', virtualizer.getVirtualItems().length, 'total size:', virtualizer.getTotalSize());
  if (virtualizer.getVirtualItems().length > 0) {
    console.log('[Virtualizer] First virtual item index:', virtualizer.getVirtualItems()[0].index, 'start:', virtualizer.getVirtualItems()[0].start);
  }

  useEffect(() => {
    if (parentRef.current) {
      const rect = parentRef.current.getBoundingClientRect();
      console.log('[Container] clientHeight:', parentRef.current.clientHeight, 'rect.height:', rect.height, 'offsetHeight:', parentRef.current.offsetHeight);
    }
    const ai = rows.findIndex(r => r.isATM);
    if (ai >= 0) virtualizer.scrollToIndex(ai, { align: 'center', behavior: 'smooth' });
  }, [rows.length, filterKey]);

  const titleAndToolbar = isDeribit ? (
    <div
      className="relative"
    >
      {/* Container title (top-left) + window controls (top-right) */}
      <div
        className="flex items-center justify-between px-1 py-0"
        style={{ backgroundColor: BG_MAIN }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Deribit 风格：标题右侧展示期权链 Tabs（可切换/可关闭，至少保留一个） */}
          <div
            ref={tabScrollRef}
            className="relative flex items-center gap-1 overflow-x-auto overflow-y-visible max-w-[520px] pr-1 pb-1"
            style={{ scrollbarWidth: 'none' as any }}
          >
            {optionsChainTabs.map(tab => {
              const isActive = tab.id === derivedActiveTabId;
              const [base, quote] = tab.coinId.split('-');
              // 币本位：BTC-USD → BTC；U 本位：BTC-USDC → BTC-USDC
              const tabLabel = quote === 'USD' ? (base ?? tab.coinId) : tab.coinId.toUpperCase();
              return (
                <div
                  key={tab.id}
                  className="relative shrink-0 group/tab"
                >
                  <button
                    ref={(node) => {
                      if (!node) tabBtnRefs.current.delete(tab.id);
                      else tabBtnRefs.current.set(tab.id, node);
                    }}
                    onClick={() => activateTab(tab.id)}
                    className="h-[26px] px-2.5 rounded-[7px] border border-transparent hover:border-white/10 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                    style={{
                      // 不要蓝色框：选中态用更大字体 + 下方滑块表达
                      background: 'rgba(255,255,255,0.03)',
                      color: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.55)',
                      fontSize: isActive ? 13 : 12,
                      fontWeight: isActive ? 800 : 700,
                    }}
                    title={tab.coinId}
                  >
                    {tabLabel}
                  </button>

                  {/* X：放在标题字体上方（遮盖 Tab），仅 hover 到 X 区域才显示 */}
                  <button
                    type="button"
                    aria-label="关闭标签"
                    title="关闭"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="absolute right-0 top-0 bottom-0 z-10 w-[30px] rounded-[7px] flex items-center justify-center border border-transparent bg-transparent text-transparent transition-[background-color,border-color,color] duration-150 ease-out hover:bg-[#0b0c0e] hover:border-white/10 hover:text-white/90 focus-visible:bg-[#0b0c0e] focus-visible:border-white/10 focus-visible:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}

            {/* underline 滑块：标题栏下方，表示当前激活 Tab */}
            <div
              aria-hidden
              className="absolute bottom-0 h-[3px] rounded-full transition-[left,width,opacity] duration-150 ease-out"
              style={{
                left: underline.left,
                width: underline.width,
                opacity: underline.opacity,
                background: 'linear-gradient(90deg, rgba(255,255,255,0.65), rgba(255,255,255,0.95), rgba(255,255,255,0.65))',
                boxShadow: '0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.25)',
              }}
            />

          </div>
          <button
            className="db-frame-iconbtn"
            onClick={() => openComponentLibrary({
              category: 'options',
              widgetId: 'options-chain',
              initialConfig: { coinId },
            })}
            aria-label="新增期权链"
            title="添加"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* 最右侧：关闭当前激活 Tab（hover 到按钮区域才显现） */}
          <button
            type="button"
            aria-label="关闭当前标签"
            title="关闭"
            disabled={!derivedActiveTabId}
            onClick={(e) => {
              e.stopPropagation();
              if (!derivedActiveTabId) return;
              closeTab(derivedActiveTabId);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] border transition-[background-color,border-color,color] duration-150 bg-transparent border-transparent text-transparent hover:bg-[#0b0c0e] hover:border-white/10 hover:text-white/90 focus-visible:bg-[#0b0c0e] focus-visible:border-white/10 focus-visible:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40"
          >
            <X size={16} />
          </button>
          <button
            className="db-frame-iconbtn"
            onClick={() => setAutoHeight(v => !v)}
            title="收起/展开"
          >
            <ChevronsUpDown size={16} />
          </button>
          <button
            className="db-frame-iconbtn"
            onClick={() => setIsMaximized(v => !v)}
            title="最大化"
          >
            <Maximize2 size={16} />
          </button>
          {/* 整个页面最右侧：关闭期权链页面（回到监控） */}
          <button
            className="db-frame-iconbtn"
            onClick={() => {
              // 这是“窗口级关闭”，不是关闭某个 Tab
              suppressUrlSyncOnceRef.current = true;
              navigate('/monitor', { replace: true });
            }}
            title="关闭"
            aria-label="关闭页面"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* top tool row (matches Deribit: Expiry dates / Columns / Filter / Dist) */}
      <div
        className="flex items-center gap-2 px-3 py-1 border-b"
        style={{ borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_MAIN }}
      >
        {/* Expiry */}
        <div className="relative">
          <button
            className="db-menu-btn"
            onClick={() => { setExpiryOpen(v => !v); setColumnsOpen(false); setFilterOpen(false); }}
          >
            到期日 <ChevronDown size={16} className="text-white/60" />
          </button>
          <Popover
            open={expiryOpen}
            onClose={() => setExpiryOpen(false)}
            backdropZ={259}
            panelZ={260}
            panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[220px]"
          >
            <div className="py-2">
              {expiries.map(e => {
                const isActive = e === expiryStr;
                return (
                  <button
                    key={e}
                    className="db-menu-item w-full text-left"
                    style={{ background: isActive ? 'rgba(47,107,255,0.18)' : undefined }}
                    onClick={() => {
                      setExpiryOpen(false);
                      changeActiveTabExpiry(e);
                    }}
                  >
                    <span className={cn("db-check", isActive && "is-on")}>
                      {isActive && <Check size={12} className="text-white" strokeWidth={3} />}
                    </span>
                    {expiryDisplay(e)}
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>

        {/* Columns */}
        <div className="relative">
          <button
            className="db-menu-btn"
            onClick={() => { setColumnsOpen(v => !v); setExpiryOpen(false); setFilterOpen(false); }}
          >
            列
          </button>
          <Popover
            open={columnsOpen}
            onClose={() => setColumnsOpen(false)}
            backdropZ={259}
            panelZ={260}
            panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[260px]"
          >
            <div className="px-3 py-2 text-[12px] font-bold text-white/55 border-b border-white/[0.08]">
              Columns
            </div>
            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.08]">
              <button
                className="text-[12px] font-semibold text-[#9BB6FF] hover:text-white transition-colors"
                onClick={() => setVisibleColIds(new Set(ALL_17_COLS.map(c => c.id)))}
              >
                Show all (35)
              </button>
              <span className="text-white/25">·</span>
              <button
                className="text-[12px] font-semibold text-white/55 hover:text-white/80 transition-colors"
                onClick={() => setVisibleColIds(new Set(['mark', 'bid', 'ask', 'ivBid', 'ivAsk', 'delta', 'size', 'pos']))}
              >
                Compact
              </button>
              <div className="ml-auto text-[12px] text-white/45">
                {visibleColIds.size}/17
              </div>
            </div>

            <div className="py-2 max-h-[420px] overflow-auto">
              {ALL_17_COLS.map(c => {
                const on = visibleColIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    className="db-menu-item w-full text-left"
                    style={{ background: on ? 'rgba(255,255,255,0.02)' : 'transparent' }}
                    onClick={() => {
                      setVisibleColIds(prev => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      });
                    }}
                  >
                    <span className={cn("db-check", on && "is-on")}>
                      {on && <Check size={12} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">
                      {c.label}
                      {c.subLabel ? <span className="ml-2 text-white/35 font-mono text-[12px]">{c.subLabel}</span> : null}
                    </span>
                    <span className="text-white/30 font-mono text-[12px]">{c.w}px</span>
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            className="db-menu-btn"
            onClick={() => { setFilterOpen(v => !v); setExpiryOpen(false); setColumnsOpen(false); }}
          >
            过滤
          </button>
          <Popover
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            backdropZ={259}
            panelZ={260}
            panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[260px]"
          >
            {([
              { k: 'all' as const,  l: 'Show all' },
              { k: 'atm5' as const, l: 'ATM around (±5)' },
              { k: 'atm10' as const, l: 'ATM around (±10)' },
            ]).map(({ k, l }) => {
              const isActive = filterKey === k;
              return (
                <button
                  key={k}
                  className="db-menu-item w-full text-left"
                  style={{ background: isActive ? 'rgba(47,107,255,0.18)' : undefined }}
                  onClick={() => { setFilterOpen(false); handleFilter(k); }}
                >
                  <span className={cn("db-check", isActive && "is-on")}>
                    {isActive && <Check size={12} className="text-white" strokeWidth={3} />}
                  </span>
                  {l}
                </button>
              );
            })}
          </Popover>
        </div>

        {/* Dist */}
        <button
          className="db-menu-btn"
          onClick={() => setShowDist(v => !v)}
          style={{ paddingInline: 12 }}
        >
          <span className={cn("db-check", showDist && "is-on")}>
            {showDist && <Check size={12} className="text-white" strokeWidth={3} />}
          </span>
          Dist
        </button>

        <div className="flex-1" />
      </div>
    </div>
  ) : (
    <>
      {/* Tab bar */}
      <div
        className="relative flex items-stretch justify-between shrink-0 border-b"
        style={{
          borderBottom: `1px solid rgba(255,255,255,${isTitleHover ? 0.10 : 0.03})`,
          minHeight: 32,
          backgroundColor: BG_HEADER,
        }}
      >
        <div
          ref={tabScrollRef}
          className="relative flex items-stretch overflow-x-auto pr-16"
          onMouseEnter={() => setIsTitleHover(true)}
          onMouseLeave={() => setIsTitleHover(false)}
        >
          {optionsChainTabs.map(tab => {
            const cfg = COIN_CFG[tab.coinId] ?? COIN_CFG['SOL-USDC'];
            const isActive = tab.id === derivedActiveTabId;
            // 币本位：BTC-USD → BTC；U 本位：BTC-USDC → BTC-USDC
            const [base, quote] = tab.coinId.split('-');
            const tabLabel = quote === 'USD' ? (base ?? cfg.label) : (tab.coinId.toUpperCase());
            return (
              <div key={tab.id} className="relative h-full flex items-center shrink-0 group/tab">
                <button
                  ref={(node) => {
                    if (!node) tabBtnRefs.current.delete(tab.id);
                    else tabBtnRefs.current.set(tab.id, node);
                  }}
                  onClick={() => activateTab(tab.id)}
                  className="h-full px-3 flex items-center text-[16px] font-extrabold whitespace-nowrap transition-colors duration-100"
                  style={{ color: isActive ? 'var(--db-text)' : 'var(--db-muted)' }}
                >
                  期权{' '}
                  <span className="ml-2 font-extrabold" style={{ color: isActive ? 'var(--db-text)' : 'var(--db-muted)' }}>
                    ({tabLabel})
                  </span>
                </button>

                {/* X：放在标题字体上方（遮盖 Tab），仅 hover 到 X 区域才显示 */}
                <button
                  type="button"
                  aria-label="关闭标签"
                  title="关闭"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                  className="absolute right-0 top-0 bottom-0 z-10 w-[30px] rounded-[10px] flex items-center justify-center border border-transparent bg-transparent text-transparent transition-[background-color,border-color,color] duration-150 ease-out hover:bg-[rgba(0,0,0,0.65)] hover:border-white/10 hover:text-white/90 focus-visible:bg-[rgba(0,0,0,0.65)] focus-visible:border-white/10 focus-visible:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}

          {/* underline 滑块：标题字下方，表示选中 */}
          <div
            aria-hidden
            className="absolute bottom-0 h-[3px] rounded-full transition-[left,width,opacity] duration-150 ease-out"
            style={{
              left: underline.left,
              width: underline.width,
              opacity: underline.opacity,
              background: 'linear-gradient(90deg, rgba(255,255,255,0.65), rgba(255,255,255,0.95), rgba(255,255,255,0.65))',
              boxShadow: '0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.25)',
            }}
          />

        </div>

        {/* 右上角悬浮操作区：X 悬停出现；+ 常驻。定位在标题文字上方靠右 */}
        <div className="absolute right-2 -top-[2px] flex items-center gap-2 z-50">
          {/* 最右侧关闭当前激活 Tab：hover 到按钮区域才显现 */}
          <button
            type="button"
            aria-label="关闭当前标签"
            title="关闭"
            disabled={!derivedActiveTabId}
            onClick={(e) => {
              e.stopPropagation();
              if (!derivedActiveTabId) return;
              closeTab(derivedActiveTabId);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] border transition-[background-color,border-color,color] duration-150 bg-transparent border-transparent text-transparent hover:bg-[rgba(0,0,0,0.65)] hover:border-white/10 hover:text-white/90 focus-visible:bg-[rgba(0,0,0,0.65)] focus-visible:border-white/10 focus-visible:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40"
          >
            <X size={16} />
          </button>
          <button
            onClick={() => openComponentLibrary({
              category: 'options',
              widgetId: 'options-chain',
              initialConfig: { coinId },
            })}
            aria-label="添加期权链"
            className="w-8 h-8 flex items-center justify-center rounded-[8px] border transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.85)' }}
            title="添加期权链"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2">
          <button
            onClick={() => setAutoHeight(v => !v)}
            aria-label="切换自适应高度"
            className="w-[26px] h-[26px] flex items-center justify-center rounded-[4px] border transition-colors duration-100 text-[10px] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4D7CFF]/60"
            style={{ borderColor: autoHeight ? 'var(--db-accent-soft)' : BORDER_C, backgroundColor: autoHeight ? 'var(--db-accent-weak)' : 'rgba(255,255,255,0.03)', color: autoHeight ? 'var(--db-accent)' : 'var(--db-muted)' }}
            title="自适应高度">↕</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b" style={{ borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_HEADER }}>
        <ToolBtn label="到期日" icon={<ChevronDown size={10} />} />
        <FilterBtn active={filterKey} onChange={handleFilter} />
        <div className="w-px h-4 mx-1" style={{ background: BORDER_C }} />
        {/* Dist toggle */}
        <div
          className="flex items-center gap-1.5 cursor-pointer select-none"
          onClick={() => setShowDist(v => !v)}
        >
          <div
            className="w-[14px] h-[14px] rounded-[3px] border flex items-center justify-center shrink-0 transition-colors duration-100"
            style={{ background: showDist ? 'var(--db-accent)' : 'transparent', borderColor: showDist ? 'var(--db-accent)' : 'var(--db-muted)' }}
          >
            {showDist && <Check size={9} className="text-white" strokeWidth={3} />}
          </div>
          <span className="text-[12px]" style={{ color: 'var(--db-muted)' }}>Dist</span>
        </div>
        <div className="flex-1" />
      </div>
    </>
  );

  const headerNode = hideHeader ? undefined : titleAndToolbar;

  return (
    <div
      className={cn(
        "db-oc-root relative flex flex-col overflow-hidden select-none",
        isDeribit && "deribit",
        isMaximized && "is-maximized"
      )}
      style={{
        backgroundColor: BG_MAIN,
        color: 'var(--db-text)',
        fontVariantNumeric: 'tabular-nums',
        height: autoHeight ? 'auto' : '100%',
        maxHeight: autoHeight ? '80vh' : '100%',
      }}
    >
      <ElasticLayout header={headerNode} restGap={isDeribit ? 0 : 2}>

        {/* ── Options chain viewport: 1280px wide, supports both-direction scroll ── */}
        <div
          ref={parentRef}
          className="overflow-auto shrink-0"
          style={{
            width: '100%',
            height: autoHeight ? 'auto' : 'calc(100vh - 160px)',
            maxWidth: '100%',
          }}
        >
          {/* Content: totalWidth wide, rows tall */}
          <div style={{ minWidth: totalWidth, position: 'relative' }}>

            {/* ── Sticky header block ── */}
            <div className="sticky top-0 z-30" style={{ backgroundColor: BG_HEADER }}>
              <SectionRow
                coinCfg={coinCfg}
                effectiveSpot={effectiveSpot}
                expiryStr={expiryStr}
                atmIV={atmIV}
                spotDp={spotDp}
                dte={dte}
                callSideWidth={colsWidth}
                emLower={emLower}
                emUpper={emUpper}
                variant={isDeribit ? 'deribit' : 'nexus'}
              />
              <ColHeaderRow
                cols={cols}
                sortKey={sortKey}
                onSort={k => setSortKey(prev => prev === k ? null : k)}
                variant={isDeribit ? 'deribit' : 'nexus'}
              />
            </div>

            {/* ── Virtualised data rows ── */}
            {allRows.length === 0 ? (
              <div className="flex items-center justify-center" style={{ height: 400 }}>
                <div className="text-center">
                  <div className="text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.50)' }}>
                    正在连接 Deribit 实时行情...
                  </div>
                  <div className="mt-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                    请确保已选择有效的到期日
                  </div>
                </div>
              </div>
            ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>

              {/* 1) ±1σ 光带：彻底垫底 (z-0)，保证连续；执行价列背景挖空用于“透视窗”透出 */}
              {emBandHeight > 0 && (
                <div
                  className="absolute left-0 w-full pointer-events-none flex justify-center z-0"
                  style={{ top: emBandTop, height: emBandHeight }}
                >
                  <div className="relative h-full" style={{ width: STRIKE_W }}>
                    <div
                      className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-[8px] bg-[#160c2c]/[0.65] border-l border-r border-[#6d28d9]/50 shadow-[inset_0_0_10px_rgba(168,85,247,0.1)]"
                    />
                  </div>
                </div>
              )}

              {/* 2) 虚拟列表内容抬高：确保所有单元格数据在光带之上 (z-10) */}
              <div className="relative z-10" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map(vItem => {
                  const row    = rows[vItem.index];
                  if (!row) {
                    return null;
                  }
                  const isEven = vItem.index % 2 === 0;
                  const isSelectedSide =
                    selectedCell?.row.strike === row.strike
                      ? (isDeribit ? 'both' : (selectedCell.side as 'call' | 'put'))
                      : null;
                  return (
                    <div
                      key={vItem.key}
                      style={{ position: 'absolute', top: vItem.start, left: 0, width: '100%', height: ROW_H }}
                    >
                      <ChainRowComp
                        row={row}
                        cols={cols}
                        loading={isLoading}
                        dec={dec}
                        isEven={isEven}
                        isSelected={isSelectedSide}
                        onRowClick={handleRowClick}
                        showDist={showDist}
                        spot={effectiveSpot}
                        emBandStrikeMin={emBandStrikeMin}
                        emBandStrikeMax={emBandStrikeMax}
                        variant={isDeribit ? 'deribit' : 'nexus'}
                      />
                    </div>
                  );
                })}
              </div>

              {/* 现价横线：放在数据文字下方（避免遮挡数字），仍然用 0 高度锚定 */}
              <div
                className="absolute left-0 w-full pointer-events-none z-[5]"
                style={{ top: `${spotY}px`, height: '0px' }}
              >
                <div className="absolute left-0 w-full h-[1px] bg-purple-500 shadow-[0_0_5px_rgba(168,85,247,0.8)] -translate-y-1/2" />
              </div>

              {/* 现价 Pill：放在 Sticky header block 下层（高于数据，低于 header） */}
              <div
                className="absolute left-0 w-full pointer-events-none z-20"
                style={{ top: `${spotY}px`, height: '0px' }}
              >
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-purple-600 text-white px-2 py-0 h-[20px] flex items-center justify-center leading-none rounded-sm text-[13px] font-bold shadow-[0_2px_4px_rgba(0,0,0,0.6)] border border-purple-400/50">
                  {currentPrice.toLocaleString()}
                </div>
              </div>
            </div>
            )}
          </div>
        </div>

      </ElasticLayout>

      {/* ── Trading Panel modal ── */}
      <AnimatePresence>
        {selectedCell && (
          <>
            <motion.div
              key="tp-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[200]"
              style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
              onClick={() => setSelectedCell(null)}
            />
            <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none">
              <motion.div
                key="tp-modal"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-[10px] overflow-hidden border pointer-events-auto"
                style={{ width: '88vw', height: '78vh', maxWidth: 1260, borderColor: BORDER_C, boxShadow: '0 32px 80px rgba(0,0,0,0.75)' }}
              >
                <TradingPanel
                  selected={selectedCell}
                  coinCfg={coinCfg}
                  effectiveSpot={effectiveSpot}
                  expiryStr={expiryStr}
                  dec={dec}
                  seed={seed}
                  onClose={() => setSelectedCell(null)}
                />
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
