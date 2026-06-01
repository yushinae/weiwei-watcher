// ═══════════════════════════════════════════════════════════════════════════════
// Options-chain shared constants — column model, theme tokens, formatters.
//
// Pure data/strings (no JSX) so cells, the trading panel and the main view can all
// import the same definitions and stay column-aligned + visually consistent.
// ═══════════════════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';
import type { Side } from './chainModel';

// ── Columns (13 per side) ─────────────────────────────────────────────────────

export type ColKey = 'pos' | 'oi' | 'dOI' | 'size' | 'ivBid' | 'bid' | 'mark' | 'ask' | 'ivAsk' | 'delta' | 'gamma' | 'vega' | 'theta';
export interface ColDef { key: ColKey; label: string; subLabel: string; w: number }
export type ViewCol = ColDef & { id: string };

export const SIDE_COLS: ViewCol[] = ([
  { key: 'pos',   label: '持仓',   subLabel: 'Pos',    w: 56 },
  { key: 'oi',    label: '未平仓', subLabel: 'OI',     w: 58 },
  { key: 'dOI',   label: 'OI变动', subLabel: 'ΔOI',    w: 54 },
  { key: 'size',  label: '数量',   subLabel: 'Size',   w: 48 },
  { key: 'ivBid', label: 'IV买',   subLabel: 'IV Bid', w: 62 },
  { key: 'bid',   label: '买价',   subLabel: 'Bid',    w: 80 },
  { key: 'mark',  label: '标记',   subLabel: 'Mark',   w: 96 },
  { key: 'ask',   label: '卖价',   subLabel: 'Ask',    w: 80 },
  { key: 'ivAsk', label: 'IV卖',   subLabel: 'IV Ask', w: 62 },
  { key: 'delta', label: 'Δ',      subLabel: 'Delta',  w: 60 },
  { key: 'gamma', label: 'Γ',      subLabel: 'Gamma',  w: 68 },
  { key: 'vega',  label: 'ν',      subLabel: 'Vega',   w: 60 },
  { key: 'theta', label: 'Θ',      subLabel: 'Theta',  w: 60 },
] as ColDef[]).map(c => ({ ...c, id: c.key }));

export const STRIKE_W = 76;
export const ROW_H = 32;

export const BG_MAIN = 'var(--db-bg-main)';     // L1 页面底
export const BG_HEADER = 'var(--db-bg-header)'; // L2 chrome/表头
export const BG_CARD = 'var(--color-card)';     // L2 卡片 #1F1F1F
export const BORDER_C = 'var(--db-border)';
export const BORDER_STRONG = 'var(--db-border-strong)';
// 卡片浮起阴影（DESIGN v5 浮起范式）
export const CARD_SHADOW = '0 12px 34px -10px rgba(0,0,0,0.55), 0 2px 8px -3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)';
export const GLOW_C = 'var(--db-accent)';

export const TABNUM: CSSProperties = {
  fontFamily: '"Inter", "SF Pro Display", "PingFang SC", sans-serif',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  letterSpacing: '-0.02em',
};

// ── Formatters ──────────────────────────────────────────────────────────────────

export function fmtV(v: number | null, dec: number) { return v === null ? '—' : v.toFixed(dec); }
export function fmtIV(v: number | null) { return v === null ? '—' : v.toFixed(1) + '%'; }
export function fmt2(v: number | null) {
  if (v === null) return '—';
  const vv = Math.abs(v) < 0.0005 ? 0 : v;
  return vv.toFixed(2);
}
export function fmtGamma5(gamma: number) {
  const vv = Math.abs(gamma) < 0.0000005 ? 0 : gamma;
  return vv.toFixed(5);
}

export function getCellValue(side: Side, col: ViewCol): { text: string; colorKey: string } {
  switch (col.key) {
    case 'pos':   return { text: fmtV(side.pos, 0), colorKey: side.pos === null ? 'dim' : side.pos > 0 ? 'green' : side.pos < 0 ? 'red' : 'normal' };
    case 'oi':    return { text: fmtV(side.oi, 0), colorKey: 'muted' };
    case 'dOI':   return { text: fmtV(side.dOI, 2), colorKey: side.dOI === null ? 'dim' : side.dOI > 0 ? 'green' : side.dOI < 0 ? 'red' : 'normal' };
    case 'size':  return { text: fmtV(side.size, 0), colorKey: 'muted' };
    case 'ivBid': return { text: fmtIV(side.ivBid), colorKey: 'muted' };
    case 'bid':   return { text: fmt2(side.bid), colorKey: side.bid !== null ? 'green' : 'dim' };
    case 'mark':  return { text: fmt2(side.mark), colorKey: 'bright' };
    case 'ask':   return { text: fmt2(side.ask), colorKey: side.ask !== null ? 'red' : 'dim' };
    case 'ivAsk': return { text: fmtIV(side.ivAsk), colorKey: 'muted' };
    case 'delta': return { text: fmt2(side.delta), colorKey: side.delta > 0 ? 'green' : side.delta < 0 ? 'red' : 'normal' };
    case 'gamma': return { text: fmtGamma5(side.gamma), colorKey: 'accent' };
    case 'vega':  return { text: fmt2(side.vega), colorKey: 'amber' };
    case 'theta': return { text: fmt2(side.theta), colorKey: 'red' };
    default:      return { text: '—', colorKey: 'dim' };
  }
}

export const COLOR_MAP: Record<string, string> = {
  green: 'var(--db-up)', red: 'var(--db-down)', muted: 'var(--db-muted)',
  bright: 'var(--db-text)', dim: 'var(--db-dim)', accent: 'var(--db-accent)',
  amber: 'var(--db-warn)', normal: 'var(--db-text)',
};

// Canonical option symbol — must match between the ticket and the live-marks feed.
export const optionSymbol = (coin: string, dateLabel: string, strike: number, type: 'C' | 'P') =>
  `${coin}-${dateLabel.replace(/\s+/g, '')}-${strike}-${type}`;
