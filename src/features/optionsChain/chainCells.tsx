// ═══════════════════════════════════════════════════════════════════════════════
// Options-chain cells & header rows — the Deribit-style grid building blocks.
//
//   Popover (click) · DataCell / MarkCell · ChainRowComp (one strike row) ·
//   ColHeaderRow (买/卖 column headers) · SectionRow (看涨/看跌 + spot/date + IV badge)
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useRef, useCallback, memo } from 'react';
import { Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import { HoverPopover } from '../../components/popup/Popup';
import type { ChainRow } from './chainModel';
import {
  STRIKE_W, ROW_H, BG_HEADER, BORDER_C, BORDER_STRONG, TABNUM, COLOR_MAP, getCellValue,
} from './chainConstants';
import type { ViewCol } from './chainConstants';

// ── Tiny click popover (backdrop + anchored panel) ───────────────────────────────

export function Popover({
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

export interface SelectedCell { row: ChainRow; side: 'call' | 'put' }

export const ChainRowComp = memo(({
  row, cols, loading, isEven, isSelected, owned, onRowClick, showDist, spot, emBandStrikeMin, emBandStrikeMax,
}: {
  row: ChainRow; cols: ViewCol[]; loading: boolean; isEven: boolean;
  isSelected: boolean; owned?: boolean; onRowClick: (row: ChainRow, side: 'call' | 'put') => void;
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

  const callCols = cols; // 两侧列序一致（买价在左、卖价在右，与 Deribit 期权链一致），不镜像
  const putCols = cols;
  const colWidths = cols.map(col => `${col.w}px`).join(' ');
  const gridTpl = `${colWidths} ${STRIKE_W}px ${colWidths}`;

  const distPct = spot > 0 ? ((strike - spot) / spot) * 100 : 0;
  const distStr = (distPct >= 0 ? '+' : '') + distPct.toFixed(2) + '%';
  const distColor = distPct > 0 ? 'var(--db-up)' : distPct < 0 ? 'var(--db-down)' : 'var(--db-muted)';
  const strikeText = strike.toLocaleString('en-US', { maximumFractionDigits: 0 });

  const sideFromX = useCallback((e: React.MouseEvent<HTMLDivElement>): 'call' | 'put' => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const callW = cols.reduce((s, col) => s + col.w, 0);
    return relX < callW + STRIKE_W / 2 ? 'call' : 'put';
  }, [cols]);
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => onRowClick(row, sideFromX(e)), [row, sideFromX, onRowClick]);
  // 悬停只高亮鼠标所在的一侧（看涨/看跌），避免两侧同时高亮分不清在哪边
  const [hoverSide, setHoverSide] = useState<'call' | 'put' | null>(null);
  const onHoverMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const s = sideFromX(e);
    setHoverSide(prev => (prev === s ? prev : s)); // 仅在跨越中线时更新，避免每像素 re-render
  }, [sideFromX]);

  return (
    <div
      className={`db-oc-row group grid${hoverSide ? ` is-hover-${hoverSide}` : ''}`}
      style={{ gridTemplateColumns: gridTpl, height: ROW_H, cursor: 'pointer', borderBottom: `1px solid ${BORDER_C}` }}
      onClick={handleClick}
      onMouseMove={onHoverMove}
      onMouseLeave={() => setHoverSide(null)}
    >
      {callCols.map((col, i) => {
        const { text, colorKey } = getCellValue(c, col);
        const isLast = i === callCols.length - 1;
        return (
          <div key={`c-${col.id}`} data-side="call" className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
            style={{ background: callBg, borderRight: isLast ? `1px solid ${BORDER_C}` : undefined }}>
            {col.key === 'mark'
              ? <MarkCell mark={c.mark} iv={c.iv} loading={loading} dimmed={!callITM && !isATM} />
              : <DataCell text={text} colorKey={colorKey} loading={loading} dimmed={!callITM && !isATM} />}
          </div>
        );
      })}

      <div className="db-oc-strike flex flex-col items-center justify-center transition-[filter] duration-75"
        style={{
          background: owned ? 'rgba(37,232,137,0.10)' : (strike >= emBandStrikeMin && strike <= emBandStrikeMax) ? 'transparent' : 'var(--db-bg-strike)',
          borderLeft: `1px solid ${BORDER_STRONG}`, borderRight: `1px solid ${BORDER_STRONG}`, position: 'relative',
          boxShadow: owned ? 'inset 0 0 0 1.5px var(--db-accent)' : undefined,
        }}>
        {owned && <span title="你在此行权价有模拟持仓" style={{ position: 'absolute', top: 2, right: 3, width: 5, height: 5, borderRadius: '50%', background: 'var(--db-accent)' }} />}
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
          <div key={`p-${col.id}`} data-side="put" className="db-oc-cell-wrap transition-[filter,background-color] duration-75"
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

export const ColHeaderRow = memo(({ cols }: { cols: ViewCol[] }) => {
  const callCols = cols; // 两侧列序一致（买价在左、卖价在右，与 Deribit 期权链一致），不镜像
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

export const SectionRow = memo(({ spot, dateLabel, atmIV, spotDp, dte, callSideWidth, emLower, emUpper }: {
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
