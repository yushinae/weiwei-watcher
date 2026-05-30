// ═══════════════════════════════════════════════════════════════════════════════
// Options Chain — Deribit-style professional grid, recolored to the app theme.
//
//   看涨期权 ←  [17 cols] │ 执行 │ [17 cols]  → 看跌期权
//
// Data source toggle (top-right): Bybit (full live) / Deribit (live IV + BS-derived
// prices & greeks). Click any row → trade panel with order book, greeks, positions.
// ═══════════════════════════════════════════════════════════════════════════════

import React, {
  useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown, X, Check, Loader2, Download, SlidersHorizontal, Filter,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { HoverPopover } from '../../components/popup/Popup';
import { useOptionChain } from './bybitTickers';
import { useDeribitOptions } from '../../registry/data/deribit';
import {
  buildBybitExpiry, buildDeribitExpiry, genBook, seedFor, dteLabel,
} from './chainModel';
import type { ChainExpiry, ChainRow, Side, Coin, DataSource } from './chainModel';
import { useOCStore, ocStore, coinOf, sourceOf, underlyingFor, tagColor, UNDERLYINGS } from './store';
import './options-chain.css';

// ─────────────────────────────────────────────────────────────────────────────
// Columns (13 per side)
// ─────────────────────────────────────────────────────────────────────────────

type ColKey = 'pos' | 'oi' | 'dOI' | 'size' | 'ivBid' | 'bid' | 'mark' | 'ask' | 'ivAsk' | 'delta' | 'gamma' | 'vega' | 'theta';
interface ColDef { key: ColKey; label: string; subLabel: string; w: number }
type ViewCol = ColDef & { id: string };

const SIDE_COLS: ViewCol[] = ([
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

const STRIKE_W = 76;
const ROW_H = 32;

const BG_MAIN = 'var(--db-bg-main)';
const BG_HEADER = 'var(--db-bg-header)';
const BORDER_C = 'var(--db-border)';
const BORDER_STRONG = 'var(--db-border-strong)';
const GLOW_C = 'var(--db-accent)';

const TABNUM: React.CSSProperties = {
  fontFamily: '"Inter", "SF Pro Display", "PingFang SC", sans-serif',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  letterSpacing: '-0.02em',
};

// ── Formatters ──────────────────────────────────────────────────────────────────

function fmtV(v: number | null, dec: number) { return v === null ? '—' : v.toFixed(dec); }
function fmtIV(v: number | null) { return v === null ? '—' : v.toFixed(1) + '%'; }
function fmt2(v: number | null) {
  if (v === null) return '—';
  const vv = Math.abs(v) < 0.0005 ? 0 : v;
  return vv.toFixed(2);
}
function fmtGamma5(gamma: number) {
  const vv = Math.abs(gamma) < 0.0000005 ? 0 : gamma;
  return vv.toFixed(5);
}

function getCellValue(side: Side, col: ViewCol): { text: string; colorKey: string } {
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

const COLOR_MAP: Record<string, string> = {
  green: 'var(--db-up)', red: 'var(--db-down)', muted: 'var(--db-muted)',
  bright: 'var(--db-text)', dim: 'var(--db-dim)', accent: 'var(--db-accent)',
  amber: 'var(--db-warn)', normal: 'var(--db-text)',
};

// ── Tiny click popover (backdrop + anchored panel) ───────────────────────────────

function Popover({
  open, onClose, children, panelClassName,
}: {
  open: boolean; onClose: () => void; children: React.ReactNode; panelClassName?: string;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[259]" onClick={onClose} />
      <div className={cn('z-[260]', panelClassName)}>{children}</div>
    </>
  );
}

// ── Cells ────────────────────────────────────────────────────────────────────────

const Skeleton = () => (
  <span className="animate-pulse select-none text-[9px] tracking-widest" style={{ color: '#2A2B38' }}>···</span>
);

const DataCell = memo(({ text, colorKey, loading, dimmed }: {
  text: string; colorKey: string; loading: boolean; dimmed: boolean;
}) => {
  const color = dimmed && text === '—' ? '#2A2D35' : COLOR_MAP[colorKey] ?? '#EAECEF';
  return (
    <div className="db-oc-cell flex items-center h-full justify-end" style={{ ...TABNUM, color }}>
      {loading ? <Skeleton /> : text}
    </div>
  );
});
DataCell.displayName = 'DataCell';

const MarkCell = memo(({ mark, iv, loading, dimmed }: {
  mark: number; iv: number; loading: boolean; dimmed: boolean;
}) => (
  <div className="db-oc-cell flex flex-col items-end justify-center h-full" style={TABNUM}>
    {loading ? <Skeleton /> : (
      <>
        <span style={{ fontSize: 'var(--db-font-cell)', color: dimmed ? 'var(--db-dim)' : 'var(--db-text)', lineHeight: 1.15 }}>{mark.toFixed(2)}</span>
        <span style={{ fontSize: 'var(--db-font-sub)', color: dimmed ? 'var(--db-dim)' : 'var(--db-muted)', lineHeight: 1.15 }}>{iv.toFixed(1)}%</span>
      </>
    )}
  </div>
));
MarkCell.displayName = 'MarkCell';

// ── Chain row ──────────────────────────────────────────────────────────────────

interface SelectedCell { row: ChainRow; side: 'call' | 'put' }

const ChainRowComp = memo(({
  row, cols, loading, isEven, isSelected, onRowClick, showDist, spot, emBandStrikeMin, emBandStrikeMax,
}: {
  row: ChainRow; cols: ViewCol[]; loading: boolean; isEven: boolean;
  isSelected: boolean; onRowClick: (row: ChainRow, side: 'call' | 'put') => void;
  showDist: boolean; spot: number; emBandStrikeMin: number; emBandStrikeMax: number;
}) => {
  const { call: c, put: p, strike, isATM, isITM } = row;
  const callITM = isITM;
  const putITM = !isITM && !isATM;

  const stripeBg = isEven ? 'var(--db-bg-row-even)' : 'var(--db-bg-row-odd)';
  const callItmBg = callITM ? 'rgba(40,200,64,0.05)' : stripeBg;
  const putItmBg = putITM ? 'rgba(255,95,87,0.05)' : stripeBg;
  const callBg = isSelected ? 'var(--db-bg-selected)' : callItmBg;
  const putBg = isSelected ? 'var(--db-bg-selected)' : putItmBg;

  const callCols = [...cols].reverse();
  const putCols = cols;
  const colWidths = cols.map(col => `${col.w}px`).join(' ');
  const gridTpl = `${colWidths} ${STRIKE_W}px ${colWidths}`;

  const distPct = spot > 0 ? ((strike - spot) / spot) * 100 : 0;
  const distStr = (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%';
  const distColor = distPct > 0 ? 'var(--db-up)' : distPct < 0 ? 'var(--db-down)' : 'var(--db-muted)';
  const strikeText = strike.toLocaleString('en-US', { maximumFractionDigits: 0 });

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const callW = cols.reduce((s, col) => s + col.w, 0);
    onRowClick(row, relX < callW + STRIKE_W / 2 ? 'call' : 'put');
  }, [row, cols, onRowClick]);

  return (
    <div
      className="db-oc-row group grid"
      style={{ gridTemplateColumns: gridTpl, height: ROW_H, cursor: 'pointer', borderBottom: `1px solid ${BORDER_C}` }}
      onClick={handleClick}
    >
      {callCols.map((col, i) => {
        const { text, colorKey } = getCellValue(c, col);
        const isLast = i === callCols.length - 1;
        return (
          <div key={`c-${col.id}`} className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
            style={{ background: callBg, borderRight: isLast ? `1px solid ${BORDER_C}` : undefined }}>
            {col.key === 'mark'
              ? <MarkCell mark={c.mark} iv={c.iv} loading={loading} dimmed={!callITM && !isATM} />
              : <DataCell text={text} colorKey={colorKey} loading={loading} dimmed={!callITM && !isATM} />}
          </div>
        );
      })}

      <div className="db-oc-strike flex flex-col items-center justify-center transition-[filter] duration-75"
        style={{
          background: (strike >= emBandStrikeMin && strike <= emBandStrikeMax) ? 'transparent' : 'var(--db-bg-strike)',
          borderLeft: `1px solid ${BORDER_STRONG}`, borderRight: `1px solid ${BORDER_STRONG}`, position: 'relative',
        }}>
        <span style={{ ...TABNUM, fontSize: 14, fontWeight: isATM ? 800 : 700, color: '#FFFFFF', lineHeight: showDist ? 1.02 : undefined }}>
          {loading ? <Skeleton /> : strikeText}
        </span>
        {showDist && (
          <span style={{ ...TABNUM, fontSize: 11, color: distColor, lineHeight: 1.02 }}>{distStr}</span>
        )}
      </div>

      {putCols.map((col, i) => {
        const { text, colorKey } = getCellValue(p, col);
        const isFirst = i === 0;
        return (
          <div key={`p-${col.id}`} className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
            style={{ background: putBg, borderLeft: isFirst ? `1px solid ${BORDER_C}` : undefined }}>
            {col.key === 'mark'
              ? <MarkCell mark={p.mark} iv={p.iv} loading={loading} dimmed={!putITM && !isATM} />
              : <DataCell text={text} colorKey={colorKey} loading={loading} dimmed={!putITM && !isATM} />}
          </div>
        );
      })}
    </div>
  );
});
ChainRowComp.displayName = 'ChainRowComp';

// ── Column header row ──────────────────────────────────────────────────────────

const SortIcon = () => (
  <svg width="8" height="10" viewBox="0 0 8 10" className="ml-0.5 inline-block opacity-40">
    <path d="M4 0L7 4H1L4 0Z" fill="var(--db-muted)" />
    <path d="M4 10L1 6H7L4 10Z" fill="var(--db-muted)" opacity="0.55" />
  </svg>
);

const HeaderCell = memo(({ col }: { col: ViewCol }) => (
  <div className="flex items-center h-full px-2 justify-end w-full">
    <span className="whitespace-nowrap" style={{
      fontSize: 'var(--db-font-header)', lineHeight: 1, fontWeight: 700, color: 'var(--db-muted)',
      textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,255,255,0.25)',
    }}>
      {col.label}<SortIcon />
    </span>
  </div>
));
HeaderCell.displayName = 'HeaderCell';

const ColHeaderRow = memo(({ cols }: { cols: ViewCol[] }) => {
  const callCols = [...cols].reverse();
  const putCols = cols;
  const colWidths = cols.map(c => `${c.w}px`).join(' ');
  const gridTpl = `${colWidths} ${STRIKE_W}px ${colWidths}`;
  return (
    <div style={{ backgroundColor: BG_HEADER }}>
      <div className="grid border-b" style={{ gridTemplateColumns: gridTpl, height: 34, borderBottom: `1px solid ${BORDER_C}` }}>
        {callCols.map((col, i) => (
          <div key={`hc-${col.id}`} style={{ borderRight: i === callCols.length - 1 ? `1px solid ${BORDER_C}` : undefined, height: '100%' }}>
            <HeaderCell col={col} />
          </div>
        ))}
        <div className="flex flex-col items-center justify-center"
          style={{ background: 'var(--db-bg-strike)', borderLeft: `1px solid ${BORDER_STRONG}`, borderRight: `1px solid ${BORDER_STRONG}`, position: 'relative', zIndex: 2 }}>
          <span className="text-[15px] font-bold" style={{ color: 'var(--db-muted)', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,255,255,0.28)', textUnderlineOffset: 3 }}>执行</span>
        </div>
        {putCols.map((col, i) => (
          <div key={`hp-${col.id}`} style={{ borderLeft: i === 0 ? `1px solid ${BORDER_C}` : undefined, height: '100%' }}>
            <HeaderCell col={col} />
          </div>
        ))}
      </div>
    </div>
  );
});
ColHeaderRow.displayName = 'ColHeaderRow';

// ── Section row (CALLS | spot/date/dte | PUTS) + IV hover popover ────────────────

const IVBadge = ({ atmIV, spot, spotDp, emLower, emUpper }: {
  atmIV: number; spot: number; spotDp: number; emLower: number; emUpper: number;
}) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deltas = useMemo(() => ({ down: Math.round(emLower - spot), up: Math.round(emUpper - spot) }), [emLower, emUpper, spot]);
  const onEnter = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } setOpen(true); };
  const onLeave = () => { closeTimer.current = setTimeout(() => setOpen(false), 120); };

  return (
    <div className="absolute right-3" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <span className="db-iv-trigger whitespace-nowrap">IV: <span className="db-iv-value">{atmIV.toFixed(1)}%</span></span>
      <HoverPopover open={open} panelZ={80} panelClassName="db-menu-panel absolute top-full right-0 mt-2 w-[380px]">
        <div className="p-3" style={{ fontSize: 13, lineHeight: 1.55 }}>
          <div className="font-bold text-white/90">
            IV: <span className="db-iv-value">{atmIV.toFixed(1)}%</span>
            <span className="text-white/65 font-mono font-semibold ml-2">({deltas.down.toLocaleString('en-US')}, +{deltas.up.toLocaleString('en-US')})</span>
          </div>
          <div className="mt-2 text-white/[0.78] font-semibold">
            标准差预计变动量，由当前虚值期权的价格推导出。预计的变动提供了期权价格暗示的价格区间，这个价格区间在期权到期时最可能*包含标的资产价格。
          </div>
          <div className="mt-2 text-white/70 font-semibold">*基于一个标准差，大约68%的时间。</div>
          <div className="mt-3 text-white/70 font-semibold">预期的区间低点由以下值给出：</div>
          <div className="mt-1 font-mono text-white/85 font-semibold">未来 / (exp(ATM_Vol * sqrt(T)))</div>
          <div className="mt-2 text-white/70 font-semibold">预期的区间高点由以下值给出：</div>
          <div className="mt-1 font-mono text-white/85 font-semibold">未来 * (exp(ATM_Vol * sqrt(T)))</div>
          <div className="mt-3 text-white/35 font-mono">spot: {spot.toLocaleString('en-US', { minimumFractionDigits: spotDp, maximumFractionDigits: spotDp })}</div>
        </div>
      </HoverPopover>
    </div>
  );
};

const SectionRow = memo(({ spot, dateLabel, atmIV, spotDp, dte, callSideWidth, emLower, emUpper }: {
  spot: number; dateLabel: string; atmIV: number; spotDp: number; dte: string;
  callSideWidth: number; emLower: number; emUpper: number;
}) => (
  <div className="flex items-center border-b shrink-0 relative" style={{ height: 36, borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_HEADER }}>
    <div className="relative flex items-center justify-center shrink-0" style={{ width: callSideWidth, height: '100%' }}>
      <div className="absolute left-3">
        <button className="flex items-center gap-1 h-[20px] px-2 rounded-[6px] border text-[12px] font-bold"
          style={{ backgroundColor: 'var(--db-accent-weak)', borderColor: 'var(--db-accent-soft)', color: 'var(--db-accent)' }}>
          <Download size={14} /> CSV
        </button>
      </div>
      <span className="font-bold" style={{ color: 'var(--db-text)', fontSize: 16, letterSpacing: '-0.01em' }}>看涨期权</span>
    </div>
    <div className="shrink-0" style={{ width: STRIKE_W }} />
    <div className="relative flex items-center justify-center shrink-0" style={{ width: callSideWidth, height: '100%' }}>
      <span className="font-bold" style={{ color: 'var(--db-text)', fontSize: 16, letterSpacing: '-0.01em' }}>看跌期权</span>
      <IVBadge atmIV={atmIV} spot={spot} spotDp={spotDp} emLower={emLower} emUpper={emUpper} />
    </div>
    <div className="flex items-center justify-center pointer-events-none" style={{ position: 'absolute', top: 0, bottom: 0, left: callSideWidth, width: STRIKE_W }}>
      <span className="whitespace-nowrap" style={{ ...TABNUM, fontSize: 17, fontWeight: 800, color: 'var(--db-text)', letterSpacing: '-0.01em' }}>{dateLabel}</span>
    </div>
    <div className="flex items-center justify-end pointer-events-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: callSideWidth - 54 }}>
      <span className="whitespace-nowrap" style={{ color: 'var(--db-muted)', fontSize: 13, fontWeight: 600 }}>
        标记: <span style={{ color: 'var(--db-text)', textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,255,255,0.25)' }}>
          ${spot.toLocaleString('en-US', { minimumFractionDigits: spotDp, maximumFractionDigits: spotDp })}
        </span>
      </span>
    </div>
    <div className="flex items-center pointer-events-none" style={{ position: 'absolute', top: 0, bottom: 0, left: callSideWidth + STRIKE_W + 54 }}>
      <span className="whitespace-nowrap" style={{ color: 'var(--db-muted)', fontSize: 13, fontWeight: 600 }}>
        到期时间: <span style={{ color: 'var(--db-text)' }}>{dte}</span>
      </span>
    </div>
  </div>
));
SectionRow.displayName = 'SectionRow';

// ─────────────────────────────────────────────────────────────────────────────
// Local order book / positions (no global store — demo state per mount)
// ─────────────────────────────────────────────────────────────────────────────

interface SimOrder { id: string; symbol: string; side: 'buy' | 'sell'; type: string; qty: number; price: number; status: 'pending' | 'filled' | 'cancelled'; createdAt: number; filledPrice?: number }
interface SimPosition { id: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; markPrice: number; unrealizedPnL: number; delta: number }
interface SimFill { id: string; symbol: string; side: 'buy' | 'sell'; qty: number; price: number; fee: number; timestamp: number }

interface PlaceArgs { side: 'buy' | 'sell'; type: 'limit' | 'market' | 'stop'; symbol: string; qty: number; price: number; mark: number; delta: number }

function useLocalBook() {
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [openOrders, setOpenOrders] = useState<SimOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<SimOrder[]>([]);
  const [fills, setFills] = useState<SimFill[]>([]);

  const placeOrder = useCallback((a: PlaceArgs) => {
    const id = Math.random().toString(36).slice(2, 9);
    const now = Date.now();
    if (a.type === 'market') {
      const px = a.mark;
      setFills(f => [...f, { id, symbol: a.symbol, side: a.side, qty: a.qty, price: px, fee: px * a.qty * 0.0005, timestamp: now }]);
      setOrderHistory(h => [...h, { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: px, status: 'filled', createdAt: now, filledPrice: px }]);
      setPositions(ps => {
        const signed = a.side === 'buy' ? a.qty : -a.qty;
        const ex = ps.find(p => p.symbol === a.symbol);
        if (!ex) {
          return [...ps, { id, symbol: a.symbol, side: signed > 0 ? 'long' : 'short', qty: Math.abs(signed), avgEntryPrice: px, markPrice: a.mark, unrealizedPnL: 0, delta: a.delta * signed }];
        }
        const cur = ex.side === 'long' ? ex.qty : -ex.qty;
        const next = cur + signed;
        if (next === 0) return ps.filter(p => p.symbol !== a.symbol);
        return ps.map(p => p.symbol === a.symbol ? { ...p, side: next > 0 ? 'long' : 'short', qty: Math.abs(next), markPrice: a.mark, delta: a.delta * next } : p);
      });
    } else {
      setOpenOrders(o => [...o, { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.price, status: 'pending', createdAt: now }]);
      setOrderHistory(h => [...h, { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.price, status: 'pending', createdAt: now }]);
    }
  }, []);

  return { positions, openOrders, orderHistory, fills, placeOrder };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trading panel (ticket + order book + greeks + positions)
// ─────────────────────────────────────────────────────────────────────────────

const BORDER = `1px solid ${BORDER_C}`;

const TradingPanel = memo(({ selected, coin, spot, dateLabel, dec, seed, book, onClose }: {
  selected: SelectedCell; coin: Coin; spot: number; dateLabel: string; dec: number; seed: number;
  book: ReturnType<typeof useLocalBook>; onClose: () => void;
}) => {
  const { row, side } = selected;
  const opt = side === 'call' ? row.call : row.put;
  const contractName = `${coin}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;
  const symbol = `${coin}-${dateLabel.replace(/\s+/g, '')}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;

  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop'>('limit');
  const [quoteMode, setQuoteMode] = useState<'price' | 'iv'>('price');
  const [price, setPrice] = useState((opt.ask ?? opt.mark).toFixed(dec));
  const [iv, setIv] = useState(opt.iv.toFixed(1));
  const [qty, setQty] = useState('0.10');
  const [tif, setTif] = useState('GTC');
  const [tifOpen, setTifOpen] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [rtab, setRtab] = useState<'book' | 'trades' | 'greeks'>('book');
  const [btab, setBtab] = useState<'position' | 'open' | 'history' | 'trades'>('position');

  const { positions, openOrders, orderHistory, fills, placeOrder } = book;

  const { asks, bids } = useMemo(() => {
    if (opt.bid === null && opt.ask === null) return { asks: [], bids: [] };
    return genBook(opt.bid, opt.ask, opt.iv, dec, seed ^ row.strike);
  }, [opt.bid, opt.ask, opt.iv, dec, seed, row.strike]);
  const maxAskTotal = asks[asks.length - 1]?.total ?? 1;
  const maxBidTotal = bids[bids.length - 1]?.total ?? 1;

  const nPrice = useMemo(() => { const p = parseFloat((price || '').replace(/,/g, '')); return Number.isFinite(p) ? p : 0; }, [price]);
  const nQty = useMemo(() => { const q = parseFloat((qty || '').replace(/,/g, '')); return Number.isFinite(q) ? q : 0; }, [qty]);
  const notional = nPrice * nQty;
  const fee = notional * 0.0005;
  const margin = notional * 0.12;
  const totalCost = notional + fee;

  const submit = (s: 'buy' | 'sell') => placeOrder({
    side: s, type: orderType, symbol, qty: nQty,
    price: orderType === 'market' ? opt.mark : nPrice, mark: opt.mark, delta: opt.delta,
  });

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ backgroundColor: BG_MAIN }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0" style={{ borderBottom: BORDER, backgroundColor: BG_HEADER }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-extrabold text-white/90 truncate">{contractName}</div>
            <span className="text-[10px] font-extrabold px-2 py-[2px] rounded-[999px] shrink-0 border" style={{
              borderColor: side === 'call' ? 'rgba(40,200,64,0.30)' : 'rgba(255,95,87,0.30)',
              background: side === 'call' ? 'rgba(40,200,64,0.10)' : 'rgba(255,95,87,0.10)',
              color: side === 'call' ? 'var(--db-up)' : 'var(--db-down)',
            }}>{side === 'call' ? 'CALL' : 'PUT'}</span>
            <span className="text-[11px] font-mono font-bold text-white/35">·</span>
            <span className="text-[11px] font-mono font-bold text-white/55">{dateLabel}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px]">
            {[
              { label: '标记', value: opt.mark.toFixed(dec), color: 'var(--db-text)' },
              { label: 'IV', value: opt.iv.toFixed(1) + '%', color: 'var(--db-warn)' },
              { label: 'Spot', value: spot.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'var(--db-muted)' },
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

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT: ticket */}
        <div className="flex flex-col shrink-0 border-r overflow-hidden" style={{ width: 320, borderRight: BORDER, backgroundColor: '#171717' }}>
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2">
              <button className="flex-1 h-11 rounded-[12px] border px-3 flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}
                onClick={() => setOrderType(t => t === 'limit' ? 'market' : 'limit')}>
                <span className="text-[13px] font-extrabold text-white/85">
                  {orderType === 'limit' ? '限价单' : orderType === 'market' ? '市价单' : '止损单'}{quoteMode === 'iv' ? '/IV' : ''}
                </span>
                <ChevronDown size={16} className="text-white/45" />
              </button>
              <button className="h-11 px-3 rounded-[12px] border flex items-center gap-2 font-extrabold text-white/85" style={{ borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }} title="RFQ">
                <span className="w-5 h-5 rounded-[8px] border flex items-center justify-center" style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.70)' }}>◇</span>RFQ
              </button>
            </div>
          </div>

          <div className="px-3 pt-3 overflow-auto">
            <div className="text-[12px] font-semibold text-white/55 mb-1.5">合约（1 = 1 {coin}）<span className="float-right text-white/45 font-mono font-bold">≈ 0.01 {coin}</span></div>
            <div className="flex items-center rounded-[12px] border" style={{ backgroundColor: '#1f1f1f', borderColor: 'rgba(255,255,255,0.10)' }}>
              <input value={qty} onChange={e => setQty(e.target.value)} className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none" style={{ ...TABNUM, color: '#EAECEF' }} />
              <div className="px-2 flex flex-col">
                <button className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => (parseFloat(v || '0') + 0.01).toFixed(2))}>▲</button>
                <button className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => Math.max(0.01, parseFloat(v || '0') - 0.01).toFixed(2))}>▼</button>
              </div>
              <div className="px-3 text-[12px] font-bold text-white/60 border-l" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>合约</div>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-white/55">可用: <span className="text-white/85 font-mono font-bold">≈ 16,849,985.46 USDC</span></div>

            <div className="mt-3 flex flex-col gap-2">
              <button onClick={() => setQuoteMode('price')} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border flex items-center justify-center" style={{ borderColor: quoteMode === 'price' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.20)' }}>
                  {quoteMode === 'price' ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
                </span>
                <span className="text-[13px] font-extrabold text-white/85">限价单</span>
                <div className="ml-auto flex items-center rounded-[10px] border overflow-hidden" style={{ backgroundColor: '#1f1f1f', borderColor: 'rgba(255,255,255,0.10)', width: 200 }}>
                  <input disabled={quoteMode !== 'price' || orderType === 'market'} value={price} onChange={e => setPrice(e.target.value)} className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none disabled:opacity-40" style={{ ...TABNUM, color: '#EAECEF' }} />
                  <span className="px-3 text-[12px] font-bold text-white/45">USDC</span>
                </div>
              </button>
              <button onClick={() => setQuoteMode('iv')} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border flex items-center justify-center" style={{ borderColor: quoteMode === 'iv' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.20)' }}>
                  {quoteMode === 'iv' ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
                </span>
                <span className="text-[13px] font-extrabold text-white/85">隐含波动率</span>
                <span className="text-[11px] font-extrabold px-2 py-[2px] rounded-full" style={{ background: 'var(--db-accent-weak)', color: 'var(--db-accent)' }}>高级</span>
                <div className="ml-auto flex items-center rounded-[10px] border overflow-hidden" style={{ backgroundColor: '#1f1f1f', borderColor: 'rgba(255,255,255,0.10)', width: 200 }}>
                  <input disabled={quoteMode !== 'iv'} value={iv} onChange={e => setIv(e.target.value)} className="flex-1 bg-transparent px-3 py-2 text-[16px] font-extrabold outline-none disabled:opacity-40" style={{ ...TABNUM, color: '#EAECEF' }} />
                  <span className="px-3 text-[12px] font-bold text-white/45">IV (%)</span>
                </div>
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.45)' }}>挂单方式</span>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{reduceOnly ? 'Reduce-only' : ''}{reduceOnly && postOnly ? ' · ' : ''}{postOnly ? 'Post-only' : ''}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button onClick={() => setReduceOnly(v => !v)} className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold" style={{ borderColor: reduceOnly ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)', background: reduceOnly ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', color: reduceOnly ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.60)' }}>减少</button>
                <button onClick={() => setPostOnly(v => !v)} className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold" style={{ borderColor: postOnly ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)', background: postOnly ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', color: postOnly ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.60)' }}>挂单</button>
                <div className="relative">
                  <button onClick={() => setTifOpen(o => !o)} className="h-8 px-3 rounded-[10px] border text-[12px] font-semibold flex items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.75)' }}>{tif} <ChevronDown size={14} className="text-white/45" /></button>
                  <Popover open={tifOpen} onClose={() => setTifOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[140px]">
                    {(['GTC', 'IOC', 'FOK'] as const).map(k => (
                      <button key={k} className="w-full flex items-center justify-between px-3 py-2 text-[12px] hover:bg-white/[0.05] transition-colors" style={{ color: k === tif ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.62)' }} onClick={() => { setTif(k); setTifOpen(false); }}>
                        <span className="font-semibold">{k}</span>{k === tif ? <Check size={14} className="text-white" strokeWidth={3} /> : <span className="opacity-0">.</span>}
                      </button>
                    ))}
                  </Popover>
                </div>
              </div>
            </div>

            <div className="mt-3 inline-flex items-center gap-2">
              <span className="text-[12px] font-extrabold px-2 py-1 rounded-[8px]" style={{ background: 'var(--db-accent-weak)', color: 'var(--db-accent)', border: '1px solid var(--db-accent-soft)' }}>仓位 0.00</span>
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={() => submit('buy')} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all" style={{ background: 'var(--db-up)' }}>买入</button>
              <button onClick={() => submit('sell')} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all" style={{ background: 'var(--db-down)' }}>卖出</button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-4 text-[12px]">
              <div><div className="text-white/45 font-semibold">购买保证金</div><div className="mt-1 text-white font-mono font-extrabold">{totalCost.toFixed(2)} USDC</div></div>
              <div className="text-right"><div className="text-white/45 font-semibold">卖出保证金</div><div className="mt-1 text-white font-mono font-extrabold">{(margin * 1.8).toFixed(2)} USDC</div></div>
            </div>

            <div className="mt-4 pt-3 border-t" style={{ borderTop: BORDER }}>
              <div className="grid grid-cols-[1fr_auto] gap-y-2 text-[12px]">
                {[
                  ['标记价格', opt.mark.toFixed(dec)], ['标记价格 IV', `${opt.iv.toFixed(1)}%`], ['价格来源', `${coin} Index`],
                  ['合约大小', `${coin} 1`], ['最小订单规模', `0.01 合同`], ['结算货币', `USDC`], ['到期日', dateLabel],
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

        {/* RIGHT */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center border-b shrink-0 px-1" style={{ borderBottom: BORDER }}>
              {([{ key: 'book', label: '订单薄' }, { key: 'trades', label: '近期交易' }, { key: 'greeks', label: 'Greeks' }] as const).map(t => (
                <button key={t.key} onClick={() => setRtab(t.key)} className="px-3 py-2 text-[12px] font-semibold shrink-0" style={{ color: rtab === t.key ? '#EAECEF' : 'rgba(255,255,255,0.42)', borderBottom: rtab === t.key ? '2px solid var(--db-accent)' : '2px solid transparent' }}>{t.label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {rtab === 'book' && (
                <div>
                  {asks.length === 0 && bids.length === 0 ? (
                    <div className="flex items-center justify-center h-[200px] text-[13px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无订单簿数据</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_1fr_1fr_1fr] px-2 py-1 border-b text-[11px]" style={{ borderBottom: BORDER, color: '#888888' }}>
                        <span className="text-right">总计</span><span className="text-right">数量</span><span className="text-right">IV%</span>
                        <span className="text-right pr-3">买价</span><span className="text-left pl-3">卖价</span>
                        <span className="text-right">IV%</span><span className="text-right">数量</span><span className="text-right">总计</span>
                      </div>
                      {Array.from({ length: Math.max(asks.length, bids.length) }, (_, i) => {
                        const a = asks[i], b = bids[i];
                        return (
                          <div key={i} className="relative grid grid-cols-[1fr_1fr_1fr_auto_auto_1fr_1fr_1fr] px-2 hover:bg-white/[0.03] cursor-pointer" style={{ height: 26 }}>
                            {a && <div className="absolute left-0 top-0 h-full pointer-events-none" style={{ width: `${(a.total / maxAskTotal) * 48}%`, background: 'rgba(255,95,87,0.08)' }} />}
                            {b && <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: `${(b.total / maxBidTotal) * 48}%`, background: 'rgba(40,200,64,0.08)' }} />}
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#888888' }}>{a ? a.total.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#EAECEF' }}>{a ? a.size.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ color: '#888888' }}>{a ? a.iv.toFixed(1) + '%' : '—'}</span>
                            <span className="text-[12px] font-medium text-right self-center pr-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: 'var(--db-down)' }} onClick={() => a && setPrice(a.price.toFixed(dec))}>{a ? a.price.toFixed(dec) : '—'}</span>
                            <span className="text-[12px] font-medium text-left self-center pl-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: 'var(--db-up)' }} onClick={() => b && setPrice(b.price.toFixed(dec))}>{b ? b.price.toFixed(dec) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ color: '#888888' }}>{b ? b.iv.toFixed(1) + '%' : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#EAECEF' }}>{b ? b.size.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#888888' }}>{b ? b.total.toFixed(2) : '—'}</span>
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
                    { label: 'Delta Δ', value: opt.delta.toFixed(4), color: 'var(--db-up)' },
                    { label: 'Gamma Γ', value: fmtGamma5(opt.gamma), color: 'var(--db-accent)' },
                    { label: 'Vega ν', value: opt.vega.toFixed(4), color: 'var(--db-warn)' },
                    { label: 'Theta Θ', value: opt.theta.toFixed(4), color: 'var(--db-down)' },
                    { label: 'IV', value: opt.iv.toFixed(2) + '%', color: 'var(--db-warn)' },
                    { label: 'Mark', value: opt.mark.toFixed(dec), color: '#EAECEF' },
                  ].map(g => (
                    <div key={g.label} className="rounded-[6px] p-3" style={{ backgroundColor: '#171717', border: `1px solid ${BORDER_C}` }}>
                      <div className="text-[10px] mb-1" style={{ color: '#888888' }}>{g.label}</div>
                      <div className="text-[14px] font-bold" style={{ ...TABNUM, color: g.color }}>{g.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {rtab === 'trades' && <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: '#888888' }}>近期无成交数据</div>}
            </div>
          </div>

          {/* BOTTOM: position / orders / history / trades */}
          <div className="shrink-0 border-t flex flex-col" style={{ borderTop: BORDER, backgroundColor: '#171717', maxHeight: 220 }}>
            <div className="flex items-center gap-3 px-3 h-9 shrink-0">
              {([
                { k: 'position' as const, l: '仓位', c: positions.length },
                { k: 'open' as const, l: '未结订单', c: openOrders.length },
                { k: 'history' as const, l: '订单历史记录', c: orderHistory.length },
                { k: 'trades' as const, l: '交易历史记录', c: fills.length },
              ]).map(t => {
                const on = btab === t.k;
                return (
                  <button key={t.k} onClick={() => setBtab(t.k)} className="text-[12px] font-semibold" style={{ color: on ? '#EAECEF' : 'rgba(255,255,255,0.45)' }}>
                    {t.l} <span style={{ color: on ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.30)' }}>{t.c}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[11px] border-t shrink-0" style={{ borderTop: BORDER, color: 'rgba(255,255,255,0.35)' }}>
              <div>产品</div><div className="text-right">数量</div><div className="text-right">值</div><div className="text-right">平均价格</div><div className="text-right">标记价格</div><div className="text-right">损益</div><div className="text-right">Δ</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {btab === 'position' && positions.length === 0 && <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无持仓</div>}
              {btab === 'position' && positions.map(p => (
                <div key={p.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold" style={{ color: p.side === 'long' ? 'var(--db-up)' : 'var(--db-down)' }}>{p.symbol}</div>
                  <div className="text-right font-mono">{p.qty.toFixed(2)}</div>
                  <div className="text-right font-mono">{(p.markPrice * p.qty).toFixed(2)}</div>
                  <div className="text-right font-mono">{p.avgEntryPrice.toFixed(2)}</div>
                  <div className="text-right font-mono">{p.markPrice.toFixed(2)}</div>
                  <div className="text-right font-mono font-bold" style={{ color: p.unrealizedPnL >= 0 ? 'var(--db-up)' : 'var(--db-down)' }}>{p.unrealizedPnL >= 0 ? '+' : ''}{p.unrealizedPnL.toFixed(2)}</div>
                  <div className="text-right font-mono">{p.delta.toFixed(3)}</div>
                </div>
              ))}
              {btab === 'open' && openOrders.length === 0 && <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无未结订单</div>}
              {btab === 'open' && openOrders.map(o => (
                <div key={o.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{o.symbol}</div><div className="text-right font-mono">{o.qty.toFixed(2)}</div><div className="text-right font-mono">—</div>
                  <div className="text-right font-mono">{o.price.toFixed(2)}</div><div className="text-right font-mono">—</div>
                  <div className="text-right font-mono" style={{ color: o.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{o.side === 'buy' ? '买入' : '卖出'}</div>
                  <div className="text-right font-mono">{o.type}</div>
                </div>
              ))}
              {btab === 'history' && orderHistory.length === 0 && <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无历史订单</div>}
              {btab === 'history' && orderHistory.slice(-20).reverse().map(o => (
                <div key={o.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{o.symbol}</div><div className="text-right font-mono">{o.qty.toFixed(2)}</div><div className="text-right font-mono">—</div>
                  <div className="text-right font-mono">{(o.filledPrice ?? o.price).toFixed(2)}</div><div className="text-right font-mono">—</div>
                  <div className="text-right font-mono" style={{ color: o.status === 'filled' ? 'var(--db-up)' : o.status === 'cancelled' ? '#888888' : 'var(--db-warn)' }}>{o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已取消' : '待成交'}</div>
                  <div className="text-right font-mono">{new Date(o.createdAt).toLocaleTimeString()}</div>
                </div>
              ))}
              {btab === 'trades' && fills.length === 0 && <div className="h-[140px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无成交记录</div>}
              {btab === 'trades' && fills.slice(-20).reverse().map(f => (
                <div key={f.id} className="grid grid-cols-[140px_1fr_1fr_1fr_1fr_1fr_1fr] px-3 py-2 text-[12px] border-t" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-mono font-bold">{f.symbol}</div><div className="text-right font-mono">{f.qty.toFixed(2)}</div><div className="text-right font-mono">{(f.price * f.qty).toFixed(2)}</div>
                  <div className="text-right font-mono">{f.price.toFixed(2)}</div><div className="text-right font-mono">{f.fee.toFixed(4)}</div>
                  <div className="text-right font-mono" style={{ color: f.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{f.side === 'buy' ? '买入' : '卖出'}</div>
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
// Main view
// ─────────────────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'atm5' | 'atm10';
const SOURCES: { key: DataSource; label: string }[] = [
  { key: 'deribit', label: 'Deribit' },
  { key: 'bybit', label: 'Bybit' },
];

export default function OptionsChainView() {
  // Selection lives in a shared store so the global nav menu stays in sync.
  const underlying = useOCStore(s => s.underlying);
  const expiryIdx = useOCStore(s => s.expiryIdx);
  const coin = coinOf(underlying);
  const source = sourceOf(underlying);
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [showDist, setShowDist] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
  const [visibleColIds, setVisibleColIds] = useState<Set<string>>(() => new Set(SIDE_COLS.map(c => c.id)));
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const bybit = useOptionChain(coin);
  const deribit = useDeribitOptions(coin);
  const loading = source === 'bybit' ? bybit.loading : deribit.loading;
  const error = source === 'bybit' ? bybit.error : null;

  const book = useLocalBook();

  const expiries: ChainExpiry[] = useMemo(() => {
    if (source === 'bybit') {
      const d = bybit.data;
      if (!d) return [];
      return d.expiries.map(g => buildBybitExpiry(g, d.spot));
    }
    const d = deribit.data;
    if (!d) return [];
    return d.expiries.map(g => buildDeribitExpiry(g, d.spot));
  }, [source, bybit.data, deribit.data]);

  const expiry = expiries[Math.min(expiryIdx, Math.max(0, expiries.length - 1))];
  const spot = expiry?.spot ?? 0;

  const cols = useMemo(() => SIDE_COLS.filter(c => visibleColIds.has(c.id)), [visibleColIds]);
  const colsWidth = cols.reduce((s, c) => s + c.w, 0);
  const totalWidth = colsWidth * 2 + STRIKE_W;

  const allRows = expiry?.rows ?? [];
  const rows = useMemo(() => {
    if (filterKey === 'all') return allRows;
    const ai = allRows.findIndex(r => r.isATM);
    if (ai < 0) return allRows;
    const n = filterKey === 'atm5' ? 5 : 10;
    return allRows.slice(Math.max(0, ai - n), ai + n + 1);
  }, [allRows, filterKey]);

  const atmIV = expiry?.atmIV ?? 0;
  const dec = spot < 1 ? 6 : spot < 100 ? 4 : 2;
  const spotDp = dec;
  const dte = expiry ? dteLabel(expiry.daysToExp) : '—';
  const seed = useMemo(() => seedFor(source + coin + (expiry?.label ?? '')), [source, coin, expiry?.label]);

  // ±1σ expected-move band
  const { emLower, emUpper } = useMemo(() => {
    const days = expiry?.daysToExp ?? 0;
    const em = spot * (atmIV / 100) * Math.sqrt(days / 365);
    return { emLower: spot - em, emUpper: spot + em };
  }, [spot, atmIV, expiry?.daysToExp]);

  const { emBandTop, emBandHeight, emBandStrikeMin, emBandStrikeMax } = useMemo(() => {
    const strikes = rows.map(r => r.strike);
    if (strikes.length === 0) return { emBandTop: 0, emBandHeight: 0, emBandStrikeMin: -Infinity, emBandStrikeMax: Infinity };
    const low = Math.min(emLower, emUpper), high = Math.max(emLower, emUpper);
    let startIdx = strikes.findIndex(s => s >= low); if (startIdx < 0) startIdx = strikes.length - 1;
    let endIdx = strikes.findIndex(s => s >= high); if (endIdx < 0) endIdx = strikes.length - 1;
    if (endIdx < startIdx) [startIdx, endIdx] = [endIdx, startIdx];
    return { emBandTop: startIdx * ROW_H, emBandHeight: (endIdx - startIdx + 1) * ROW_H, emBandStrikeMin: strikes[startIdx], emBandStrikeMax: strikes[endIdx] };
  }, [rows, emLower, emUpper]);

  const spotY = useMemo(() => {
    const strikes = rows.map(r => r.strike);
    const upperIndex = strikes.findIndex(s => s >= spot);
    if (upperIndex <= 0) return ROW_H / 2;
    return upperIndex * ROW_H;
  }, [rows, spot]);

  const handleRowClick = useCallback((row: ChainRow, side: 'call' | 'put') => {
    setSelectedCell(prev => prev?.row.strike === row.strike && prev?.side === side ? null : { row, side });
  }, []);

  useEffect(() => {
    if (!selectedCell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedCell(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCell]);

  // Reset selection when underlying changes (store already resets expiryIdx)
  useEffect(() => { setSelectedCell(null); }, [underlying]);

  // Publish expiry list to the shared store so the global nav menu can show it.
  useEffect(() => {
    ocStore.setExpiries(expiries.map(e => ({ key: e.key, label: e.label, daysToExp: e.daysToExp })));
  }, [expiries]);

  // Auto-scroll: center the strike column horizontally + ATM row vertically
  const parentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const left = colsWidth + STRIKE_W / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left) });
    const ai = rows.findIndex(r => r.isATM);
    if (ai >= 0) {
      const top = ai * ROW_H - el.clientHeight / 2 + 120;
      el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
    }
  }, [expiry?.key, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="db-oc-root deribit relative flex flex-col overflow-hidden select-none h-full"
      style={{ backgroundColor: BG_MAIN, color: 'var(--db-text)', fontVariantNumeric: 'tabular-nums' }}>

      {/* ── Title bar: 标的 label (左) + 数据源切换 (右上角) ── */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0" style={{ backgroundColor: BG_MAIN }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold text-white/35">期权</span>
          <span className="text-[14px] font-extrabold text-white/90 tracking-tight font-mono">{underlying}</span>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" />}
        </div>

        {/* Data source toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">数据源</span>
          <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--color-bg-base)', border: '1px solid var(--db-border)' }}>
            {SOURCES.map(s => (
              <button key={s.key} onClick={() => { if (s.key !== source) ocStore.setUnderlying(underlyingFor(coin, s.key)); }}
                className="px-3 py-1 rounded-md text-xs font-bold transition-colors"
                style={{ background: source === s.key ? 'var(--db-accent)' : 'transparent', color: source === s.key ? '#0b0b0b' : 'rgba(255,255,255,0.55)' }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Toolbar: 到期日 / Columns / Filter / Dist ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0" style={{ borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_MAIN }}>
        {/* 到期日 dropdown */}
        <div className="relative">
          <button className="db-menu-btn" onClick={() => { setExpiryMenuOpen(v => !v); setColumnsOpen(false); setFilterOpen(false); }}>
            到期日{expiry && <span className="font-mono font-bold" style={{ color: 'var(--db-accent)' }}>{expiry.label}</span>}
            <ChevronDown size={14} className="text-white/50" />
          </button>
          <Popover open={expiryMenuOpen} onClose={() => setExpiryMenuOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[220px]">
            <div className="py-2 max-h-[360px] overflow-auto">
              {expiries.length === 0 && <div className="px-3 py-2 text-[12px] text-white/35">加载中…</div>}
              {expiries.map((e, i) => {
                const on = i === expiryIdx;
                return (
                  <button key={e.key} className="db-menu-item text-left" onClick={() => { setExpiryMenuOpen(false); ocStore.setExpiryIdx(i); setSelectedCell(null); }}>
                    <span className={cn('db-check', on && 'is-on')}>{on && <Check size={12} className="text-black" strokeWidth={3} />}</span>
                    <span className="flex-1 font-semibold">{e.dateLabel}</span>
                    <span className="text-white/35 font-mono text-[11px]">{dteLabel(e.daysToExp)}</span>
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>

        <div className="w-px h-4" style={{ background: BORDER_C }} />

        <div className="relative">
          <button className="db-menu-btn" onClick={() => { setColumnsOpen(v => !v); setFilterOpen(false); setExpiryMenuOpen(false); }}>
            <SlidersHorizontal size={13} /> 列
          </button>
          <Popover open={columnsOpen} onClose={() => setColumnsOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[260px]">
            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.08]">
              <button className="text-[12px] font-semibold" style={{ color: 'var(--db-accent)' }} onClick={() => setVisibleColIds(new Set(SIDE_COLS.map(c => c.id)))}>全选</button>
              <span className="text-white/25">·</span>
              <button className="text-[12px] font-semibold text-white/55 hover:text-white/80" onClick={() => setVisibleColIds(new Set(['mark', 'bid', 'ask', 'ivBid', 'ivAsk', 'delta', 'size', 'pos']))}>精简</button>
              <div className="ml-auto text-[12px] text-white/45">{visibleColIds.size}/{SIDE_COLS.length}</div>
            </div>
            <div className="py-2 max-h-[420px] overflow-auto">
              {SIDE_COLS.map(c => {
                const on = visibleColIds.has(c.id);
                return (
                  <button key={c.id} className="db-menu-item text-left" onClick={() => setVisibleColIds(prev => {
                    const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next;
                  })}>
                    <span className={cn('db-check', on && 'is-on')}>{on && <Check size={12} className="text-black" strokeWidth={3} />}</span>
                    <span className="flex-1">{c.label}<span className="ml-2 text-white/35 font-mono text-[12px]">{c.subLabel}</span></span>
                    <span className="text-white/30 font-mono text-[12px]">{c.w}px</span>
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>

        <div className="relative">
          <button className="db-menu-btn" onClick={() => { setFilterOpen(v => !v); setColumnsOpen(false); }}>
            <Filter size={12} /> 过滤{filterKey !== 'all' && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--db-accent)' }} />}
          </button>
          <Popover open={filterOpen} onClose={() => setFilterOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[220px]">
            {([{ k: 'all' as const, l: '全部行权价' }, { k: 'atm5' as const, l: 'ATM ±5 档' }, { k: 'atm10' as const, l: 'ATM ±10 档' }]).map(({ k, l }) => (
              <button key={k} className="db-menu-item text-left" onClick={() => { setFilterOpen(false); setFilterKey(k); }}>
                <span className={cn('db-check', filterKey === k && 'is-on')}>{filterKey === k && <Check size={12} className="text-black" strokeWidth={3} />}</span>{l}
              </button>
            ))}
          </Popover>
        </div>

        <button className="db-menu-btn" onClick={() => setShowDist(v => !v)}>
          <span className={cn('db-check', showDist && 'is-on')}>{showDist && <Check size={12} className="text-black" strokeWidth={3} />}</span>Dist
        </button>

        <div className="flex-1" />
      </div>

      {/* ── Table viewport ── */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto" style={{ width: '100%' }}>
        <div style={{ minWidth: totalWidth, position: 'relative' }}>
          {/* Sticky header */}
          <div className="sticky top-0 z-30" style={{ backgroundColor: BG_HEADER }}>
            <SectionRow spot={spot} dateLabel={expiry?.dateLabel ?? '—'} atmIV={atmIV} spotDp={spotDp} dte={dte}
              callSideWidth={colsWidth} emLower={emLower} emUpper={emUpper} />
            <ColHeaderRow cols={cols} />
          </div>

          {allRows.length === 0 ? (
            <div className="flex items-center justify-center" style={{ height: 400 }}>
              <div className="text-center">
                {error ? (
                  <div className="text-[14px] font-semibold" style={{ color: 'var(--db-down)' }}>{error}</div>
                ) : (
                  <>
                    <div className="text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.50)' }}>正在加载 {source === 'bybit' ? 'Bybit' : 'Deribit'} 期权数据...</div>
                    <div className="mt-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>请稍候</div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {/* ±1σ band */}
              {emBandHeight > 0 && (
                <div className="absolute left-0 w-full pointer-events-none flex justify-center z-0" style={{ top: emBandTop, height: emBandHeight }}>
                  <div className="relative h-full" style={{ width: STRIKE_W }}>
                    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-[8px]"
                      style={{ background: 'rgba(37,232,137,0.10)', borderLeft: '1px solid var(--db-accent-soft)', borderRight: '1px solid var(--db-accent-soft)', boxShadow: 'inset 0 0 10px rgba(37,232,137,0.12)' }} />
                  </div>
                </div>
              )}

              {/* Rows */}
              <div className="relative z-10" style={{ height: rows.length * ROW_H }}>
                {rows.map((row, idx) => {
                  const isSelected = selectedCell?.row.strike === row.strike;
                  return (
                    <div key={row.strike} style={{ position: 'absolute', top: idx * ROW_H, left: 0, width: '100%', height: ROW_H }}>
                      <ChainRowComp row={row} cols={cols} loading={false} isEven={idx % 2 === 0}
                        isSelected={!!isSelected} onRowClick={handleRowClick} showDist={showDist} spot={spot}
                        emBandStrikeMin={emBandStrikeMin} emBandStrikeMax={emBandStrikeMax} />
                    </div>
                  );
                })}
              </div>

              {/* Spot line */}
              <div className="absolute left-0 w-full pointer-events-none z-[5]" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-0 w-full h-[1px] -translate-y-1/2" style={{ background: 'var(--db-spot)', boxShadow: '0 0 6px rgba(37,232,137,0.85)' }} />
              </div>
              <div className="absolute left-0 w-full pointer-events-none z-20" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 h-[20px] flex items-center justify-center leading-none rounded-sm text-[13px] font-bold"
                  style={{ background: 'var(--db-spot)', color: '#0b0b0b', boxShadow: '0 2px 6px rgba(0,0,0,0.6)', border: '1px solid rgba(37,232,137,0.6)' }}>
                  {spot.toLocaleString('en-US', { maximumFractionDigits: dec })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Trade panel modal ── */}
      <AnimatePresence>
        {selectedCell && expiry && (
          <>
            <motion.div key="tp-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[200]" style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
              onClick={() => setSelectedCell(null)} />
            <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none p-4">
              <motion.div key="tp-modal" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="rounded-[10px] overflow-hidden border pointer-events-auto"
                style={{ width: '88vw', height: '78vh', maxWidth: 1260, borderColor: BORDER_C, boxShadow: '0 32px 80px rgba(0,0,0,0.75)' }}>
                <TradingPanel selected={selectedCell} coin={coin} spot={spot} dateLabel={expiry.dateLabel} dec={dec} seed={seed} book={book} onClose={() => setSelectedCell(null)} />
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
