// ═══════════════════════════════════════════════════════════════════════════════
// Options Chain — Deribit-style professional grid, recolored to the app theme.
//
//   看涨期权 ←  [13 cols] │ 执行 │ [13 cols]  → 看跌期权
//
// Data source toggle (top-right): Bybit (full live) / Deribit (live IV + BS-derived
// prices & greeks). Click any row → trade panel with order book, greeks, positions.
//
// The grid building blocks live in sibling files:
//   chainConstants.ts  column model · theme tokens · formatters · optionSymbol
//   chainCells.tsx     Popover · cells · ChainRowComp · ColHeaderRow · SectionRow
//   simBook.ts         simulated order-book / positions engine (useLocalBook)
//   TradingPanel.tsx   FrameControls · PositionsPanel · TradingPanel (trade modal)
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check, Loader2, SlidersHorizontal, Filter } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOptionChain } from './bybitTickers';
import { useLiveSpot, useChainStream } from './liveData';
import { useDeribitChainOptions } from '../../registry/data/deribit';
import { buildBybitExpiry, buildDeribitExpiry, seedFor, dteLabel } from './chainModel';
import type { ChainExpiry, ChainRow } from './chainModel';
import { useOCStore, ocStore, coinOf, sourceOf, underlyingFor } from './store';
import {
  SIDE_COLS, STRIKE_W, ROW_H, BG_MAIN, BG_HEADER, BG_CARD, BORDER_C, CARD_SHADOW, optionSymbol,
} from './chainConstants';
import { Popover, ChainRowComp, ColHeaderRow, SectionRow } from './chainCells';
import type { SelectedCell } from './chainCells';
import { useLocalBook } from './simBook';
import { FrameControls, PositionsPanel, TradingPanel } from './TradingPanel';
import './options-chain.css';

type FilterKey = 'all' | 'atm5' | 'atm10';

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
  const [maximized, setMaximized] = useState(false);       // fullscreen the whole chain view
  const [chainCollapsed, setChainCollapsed] = useState(false); // collapse the chain grid to its header

  const bybit = useOptionChain(coin);
  const deribit = useDeribitChainOptions(coin);
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
  // Live spot from Deribit index WS (1 Hz); falls back to the REST snapshot's spot.
  const liveSpot = useLiveSpot(coin);
  const spot = liveSpot ?? expiry?.spot ?? 0;

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

  // ── Live WebSocket overlay: merge per-strike ticks onto the REST rows (1 Hz) ──
  const liveTicks = useChainStream(source, expiry);
  const liveRows = useMemo(() => {
    if (Object.keys(liveTicks).length === 0) return rows;
    return rows.map(r => {
      const c = liveTicks[`C-${r.strike}`];
      const p = liveTicks[`P-${r.strike}`];
      if (!c && !p) return r;
      return { ...r, call: c ? { ...r.call, ...c } : r.call, put: p ? { ...r.put, ...p } : r.put };
    });
  }, [rows, liveTicks]);

  // Re-resolve the open trade ticket's row from live data so its header / greeks /
  // order book track the WS stream instead of a click-time snapshot.
  const liveSelected = useMemo<SelectedCell | null>(() => {
    if (!selectedCell) return null;
    const liveRow = liveRows.find(r => r.strike === selectedCell.row.strike) ?? selectedCell.row;
    return { row: liveRow, side: selectedCell.side };
  }, [selectedCell, liveRows]);

  const atmIV = expiry?.atmIV ?? 0;
  const dec = spot < 1 ? 6 : spot < 100 ? 4 : 2;
  const spotDp = dec;
  const dte = expiry ? dteLabel(expiry.daysToExp) : '—';
  const seed = useMemo(() => seedFor(source + coin + (expiry?.label ?? '')), [source, coin, expiry?.label]);

  // Feed live marks → positions mark-to-market + fill marketable resting orders.
  const updateMarks = book.updateMarks;
  useEffect(() => {
    if (!expiry) return;
    const marks: Record<string, number> = {};
    for (const r of expiry.rows) {
      if (r.call.mark > 0) marks[optionSymbol(coin, expiry.dateLabel, r.strike, 'C')] = r.call.mark;
      if (r.put.mark > 0) marks[optionSymbol(coin, expiry.dateLabel, r.strike, 'P')] = r.put.mark;
    }
    updateMarks(marks);
  }, [expiry, coin, updateMarks]);

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

  // Auto-scroll: center the strike column horizontally + ATM row vertically
  const parentRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Single chain scroller (both axes): center the strike column + ATM row.
    const el = dataRef.current;
    if (!el) return;
    const left = colsWidth + STRIKE_W / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left) });
    const ai = rows.findIndex(r => r.isATM);
    if (ai >= 0) {
      const top = ai * ROW_H + 70 - el.clientHeight / 2; // +70 ≈ sticky header height
      el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [expiry?.key, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Row virtualization: only mount the rows in (or near) the chain viewport ──
  // Big chains ("全部行权价" on ETH can be 50+ strikes) otherwise mount every row and
  // re-reconcile all of them on each 1 Hz tick. We window to ~viewport + overscan.
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [winRange, setWinRange] = useState({ start: 0, end: 60 });

  const recalcWindow = useCallback(() => {
    const sc = dataRef.current;
    if (!sc) return;
    const headH = rowsAreaRef.current?.offsetTop ?? 70; // sticky header (SectionRow + ColHeaderRow)
    const top = Math.max(0, sc.scrollTop - headH);
    const overscan = 6;
    const first = Math.max(0, Math.floor(top / ROW_H) - overscan);
    const last = first + Math.ceil(sc.clientHeight / ROW_H) + overscan * 2;
    setWinRange(prev => (prev.start === first && prev.end === last ? prev : { start: first, end: last }));
  }, []);

  const onChainScroll = useCallback(() => {
    if (rafRef.current != null) return; // coalesce bursts into one rAF
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; recalcWindow(); });
  }, [recalcWindow]);

  // Recompute the window when the row set / layout changes (and once on mount).
  useEffect(() => { recalcWindow(); }, [recalcWindow, rows.length, expiry?.key, filterKey]);
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <div className={cn('db-oc-root deribit flex flex-col overflow-hidden select-none',
      maximized ? 'fixed inset-0 z-[100]' : 'relative h-full')}
      style={{ backgroundColor: BG_MAIN, color: 'var(--db-text)', fontVariantNumeric: 'tabular-nums' }}>

      {/* ── Container 2: vertical-only scroll area for card + positions ── */}
      <div ref={parentRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden pb-1">

        {/* ── Title bar: 标的 + tab 控件（左） + 窗口控件（右上） ── */}
        <div className="flex items-center gap-1 pt-1.5" style={{ backgroundColor: BG_HEADER }}>
          {/* 标的标题 */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center">
              <span className="text-[14px] font-extrabold text-white/90 tracking-tight font-mono">{underlying}</span>
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30 ml-1.5" />}
            </div>
            <div className="shrink-0 mt-0.5" style={{ height: 2, backgroundColor: '#1E90FF' }} />
          </div>
          <div className="flex-1" />
          {/* 窗口控件（右上）：最大化 / 收起 */}
          <FrameControls
            maximized={maximized} onToggleMaximize={() => setMaximized(m => !m)}
            collapsed={chainCollapsed} onToggleCollapse={() => setChainCollapsed(c => !c)} />
        </div>

        {/* ── Toolbar: 到期日 / Columns / Filter / Dist （窄屏换行） ── */}
        <div className="flex flex-wrap items-center gap-2 py-1.5 border-b" style={{ borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_HEADER }}>
          <div className="relative">
            <button className="db-menu-btn" onClick={() => { setExpiryMenuOpen(v => !v); setColumnsOpen(false); setFilterOpen(false); }}>
              到期日{expiry && <span className="font-mono font-bold" style={{ color: 'var(--db-accent)' }}>{expiry.label}</span>}
              {expiry && expiry.daysToExp < 2 && (
                <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-full"
                  style={expiry.daysToExp < 1 ? { background: 'rgba(255,95,87,0.18)', color: '#FF5F57' } : { background: 'rgba(254,188,46,0.18)', color: '#FEBC2E' }}>
                  {expiry.daysToExp < 1 ? '末日' : '临期'}
                </span>
              )}
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
                      {e.daysToExp < 2 && (
                        <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-full mr-1"
                          style={e.daysToExp < 1 ? { background: 'rgba(255,95,87,0.18)', color: '#FF5F57' } : { background: 'rgba(254,188,46,0.18)', color: '#FEBC2E' }}>
                          {e.daysToExp < 1 ? '末日' : '临期'}
                        </span>
                      )}
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

          {/* 数据源标识（点击切换）— 后续随卡片做成组件样式 */}
          {(() => {
            const c = source === 'bybit' ? '#f7a600' : 'var(--db-accent)';
            return (
              <button
                type="button"
                onClick={() => ocStore.setUnderlying(underlyingFor(coin, source === 'bybit' ? 'deribit' : 'bybit'))}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full border transition-[filter] hover:brightness-125 shrink-0"
                style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
                aria-label={`切换数据源（当前 ${source === 'bybit' ? 'Bybit' : 'Deribit'}）`}
                title="切换数据源"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                <span className="text-[11px] font-extrabold" style={{ color: c }}>{source === 'bybit' ? 'Bybit' : 'Deribit'}</span>
              </button>
            );
          })()}
        </div>
        {/* Chain card — flex-1 so data area fills remaining height, has own bi‑directional scroll.
            Collapsed (收起) hides the grid; the title bar + toolbar stay so it can be expanded again. */}
        <div className="flex flex-col shrink-0 rounded-xl border" style={{ overflow: 'hidden', borderColor: BORDER_C, backgroundColor: BG_CARD, boxShadow: CARD_SHADOW, display: chainCollapsed ? 'none' : undefined }}>
          {/* Single bi-directional scroller: headers + rows share one scroll context, so
              horizontal scroll keeps them aligned and vertical scroll pins the header. */}
          <div ref={dataRef} onScroll={onChainScroll} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <div style={{ minWidth: totalWidth, position: 'relative' }}>
              {/* Sticky header — pinned on vertical scroll, moves with columns on horizontal scroll */}
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
            <div ref={rowsAreaRef} style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {/* ±1σ band */}
              {emBandHeight > 0 && (
                <div className="absolute left-0 w-full pointer-events-none flex justify-center z-0" style={{ top: emBandTop, height: emBandHeight }}>
                  <div className="relative h-full" style={{ width: STRIKE_W }}>
                    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-[8px]"
                      style={{ background: 'rgba(30,144,255,0.10)', borderLeft: '1px solid var(--db-accent-soft)', borderRight: '1px solid var(--db-accent-soft)', boxShadow: 'inset 0 0 10px rgba(30,144,255,0.12)' }} />
                  </div>
                </div>
              )}

              {/* Rows — only the windowed slice is mounted (see recalcWindow). */}
              <div className="relative z-10" style={{ height: rows.length * ROW_H }}>
                {liveRows.slice(winRange.start, winRange.end).map((row, i) => {
                  const idx = winRange.start + i;
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
                <div className="absolute left-0 w-full h-[1px] -translate-y-1/2" style={{ background: 'var(--db-spot)', boxShadow: '0 0 6px rgba(30,144,255,0.85)' }} />
              </div>
              <div className="absolute left-0 w-full pointer-events-none z-20" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 h-[20px] flex items-center justify-center leading-none rounded-sm text-[13px] font-bold"
                  style={{ background: 'var(--db-spot)', color: '#0b0b0b', boxShadow: '0 2px 6px rgba(0,0,0,0.6)', border: '1px solid rgba(30,144,255,0.6)' }}>
                  {spot.toLocaleString('en-US', { maximumFractionDigits: dec })}
                </div>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>

        {/* ── Positions card — independent bi-directional scroll ── */}
        <div className="mt-1 overflow-auto shrink-0 w-full">
          <PositionsPanel book={book} embedded />
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
              <motion.div key="tp-modal" role="dialog" aria-modal="true"
                aria-label={`${coin}-${selectedCell.row.strike}-${selectedCell.side === 'call' ? 'C' : 'P'} 期权下单面板（模拟）`}
                initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="rounded-[10px] overflow-hidden border pointer-events-auto"
                style={{ width: '88vw', height: '78vh', maxWidth: 1260, borderColor: BORDER_C, boxShadow: '0 32px 80px rgba(0,0,0,0.75)' }}>
                <TradingPanel selected={liveSelected ?? selectedCell} coin={coin} source={source} spot={spot} dateLabel={expiry.dateLabel} dec={dec} seed={seed} book={book} onClose={() => setSelectedCell(null)} />
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
