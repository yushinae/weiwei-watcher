/// ═══════════════════════════════════════════════════════════════════════════════
// Options Chain — Deribit-style professional grid, recolored to the app theme.
//
//   看涨期权 ←  [13 cols] │ 执行 │ [13 cols]  → 看跌期权
//
// Top tab bar: click + to add another underlying as a tab, switch between them.
// Data source toggle (top-right): Bybit (full live) / Deribit (live IV + BS-derived
// prices & greeks). Click any row → trade panel with order book, greeks, positions.
/// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check, SlidersHorizontal, Filter, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOptionChain } from './bybitTickers';
import { useLiveSpot, useChainStream } from './liveData';
import { useDeribitOptions } from '../../registry/data/deribit';
import { buildBybitExpiry, buildDeribitExpiry, dteLabel } from './chainModel';
import type { ChainExpiry, ChainRow } from './chainModel';
import { ocStore, useOCStore, coinOf, sourceOf, underlyingFor, UNDERLYING_GROUPS } from './store';
import {
  SIDE_COLS, STRIKE_W, ROW_H, BG_MAIN, BG_HEADER, BG_CARD, BORDER_C, CARD_SHADOW, optionSymbol,
} from './chainConstants';
import { Popover, ChainRowComp, ColHeaderRow, SectionRow } from './chainCells';
import type { SelectedCell } from './chainCells';
import { useGlobalOptionBook } from './optionBookStore';
import { FrameControls, PositionsPanel, TradingPanel } from './TradingPanel';
import './options-chain.css';

type FilterKey = 'all' | 'atm5' | 'atm10';
type TabState = {
  expiryIdx: number;
  filterKey: FilterKey;
  showDist: boolean;
  visibleColIds: string[];
};

const DEFAULT_VISIBLE_COL_IDS = SIDE_COLS.map(c => c.id);
const DEFAULT_TAB_STATE: TabState = {
  expiryIdx: 0,
  filterKey: 'all',
  showDist: false,
  visibleColIds: DEFAULT_VISIBLE_COL_IDS,
};

export default function OptionsChainView() {
  // ── Tabs: multiple underlying tabs, click to switch ─────────────────────
  const [tabs, setTabs] = useState<string[]>(['BTC_USDC']);
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Per-tab remembered state (expiryIdx, filter, columns, dist) keyed by underlying.
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});

  const activeUnderlying = tabs[activeTabIdx] ?? 'BTC_USDC';
  const coin = coinOf(activeUnderlying);
  const source = sourceOf(activeUnderlying);

  const tabState = tabStates[activeUnderlying] ?? DEFAULT_TAB_STATE;
  const navUnderlying = useOCStore(s => s.underlying);
  const navExpiryIdx = useOCStore(s => s.expiryIdx);

  const setTabState = useCallback((patch: Partial<typeof tabState>) => {
    setTabStates(prev => ({
      ...prev,
      [activeUnderlying]: { ...(prev[activeUnderlying] ?? DEFAULT_TAB_STATE), ...patch },
    }));
  }, [activeUnderlying]);

  // Sync the shared store so the global nav "期权" hover stays in sync.
  useEffect(() => { ocStore.setUnderlying(activeUnderlying); }, [activeUnderlying]);

  // When the top-nav picker chooses an underlying/expiry before entering this page,
  // materialize that selection as a real tab + per-tab expiry here.
  useEffect(() => {
    if (!navUnderlying) return;
    setTabs(prev => {
      const existingIdx = prev.indexOf(navUnderlying);
      if (existingIdx >= 0) {
        setActiveTabIdx(existingIdx);
        return prev;
      }
      setActiveTabIdx(prev.length);
      return [...prev, navUnderlying];
    });
    setTabStates(prev => ({
      ...prev,
      [navUnderlying]: {
        ...(prev[navUnderlying] ?? DEFAULT_TAB_STATE),
        expiryIdx: navExpiryIdx,
      },
    }));
    setSelectedCell(null);
  }, [navUnderlying, navExpiryIdx]);

  const addTab = useCallback((u: string) => {
    setTabs(prev => {
      if (prev.includes(u)) return prev;
      const next = [...prev, u];
      setActiveTabIdx(next.length - 1);
      return next;
    });
    setAddMenuOpen(false);
  }, []);

  const removeTab = useCallback((idx: number) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      if (activeTabIdx >= next.length) setActiveTabIdx(next.length - 1);
      else if (activeTabIdx > idx) setActiveTabIdx(activeTabIdx - 1);
      return next;
    });
  }, [activeTabIdx]);

  // ── Chain data ──────────────────────────────────────────────────────────
  const expiryIdx = tabState.expiryIdx;
  const filterKey = tabState.filterKey;
  const showDist = tabState.showDist;
  const visibleColIds = useMemo(() => new Set(tabState.visibleColIds), [tabState.visibleColIds]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [chainCollapsed, setChainCollapsed] = useState(false);

  const bybit = useOptionChain(coin);
  const deribit = useDeribitOptions(coin);
  const error = source === 'bybit' ? bybit.error : null;

  const book = useGlobalOptionBook();

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
  const liveSpot = useLiveSpot(coin);
  const spot = liveSpot ?? expiry?.spot ?? 0;

  const cols = useMemo(() => SIDE_COLS.filter(c => visibleColIds.has(c.id)), [visibleColIds]);
  const colsWidth = cols.reduce((s, c) => s + c.w, 0);
  const totalWidth = colsWidth * 2 + STRIKE_W;

  const allRows = useMemo(() => expiry?.rows ?? [], [expiry]);
  const rows = useMemo(() => {
    if (filterKey === 'all') return allRows;
    const ai = allRows.findIndex(r => r.isATM);
    if (ai < 0) return allRows;
    const n = filterKey === 'atm5' ? 5 : 10;
    return allRows.slice(Math.max(0, ai - n), ai + n + 1);
  }, [allRows, filterKey]);

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

  const liveSelected = useMemo<SelectedCell | null>(() => {
    if (!selectedCell) return null;
    const liveRow = liveRows.find(r => r.strike === selectedCell.row.strike) ?? selectedCell.row;
    return { row: liveRow, side: selectedCell.side };
  }, [selectedCell, liveRows]);

  const atmIV = expiry?.atmIV ?? 0;
  const dec = spot < 1 ? 6 : spot < 100 ? 4 : 2;
  const spotDp = dec;
  const dte = expiry ? dteLabel(expiry.daysToExp) : '—';

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

  const ownedSidesByStrike = useMemo(() => {
    if (!expiry) return new Map<number, 'call' | 'put' | 'both'>();
    const next = new Map<number, 'call' | 'put' | 'both'>();
    for (const p of book.positions) {
      const side = p.symbol.endsWith('-C') ? 'call' : p.symbol.endsWith('-P') ? 'put' : null;
      if (!side) continue;
      for (const r of expiry.rows) {
        const expected = optionSymbol(coin, expiry.dateLabel, r.strike, side === 'call' ? 'C' : 'P');
        if (p.symbol !== expected) continue;
        const prev = next.get(r.strike);
        next.set(r.strike, prev && prev !== side ? 'both' : side);
        break;
      }
    }
    return next;
  }, [book.positions, coin, expiry]);

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

  useEffect(() => { setSelectedCell(null); }, [activeUnderlying]);

  // Auto-scroll
  const parentRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dataRef.current;
    if (!el) return;
    const left = colsWidth + STRIKE_W / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left) });
    const ai = rows.findIndex(r => r.isATM);
    if (ai >= 0) {
      const top = ai * ROW_H + 70 - el.clientHeight / 2;
      el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }, [expiry?.key, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Row virtualization
  const rowsAreaRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [winRange, setWinRange] = useState({ start: 0, end: 60 });

  const recalcWindow = useCallback(() => {
    const sc = dataRef.current;
    if (!sc) return;
    const headH = rowsAreaRef.current?.offsetTop ?? 70;
    const top = Math.max(0, sc.scrollTop - headH);
    const overscan = 6;
    const first = Math.max(0, Math.floor(top / ROW_H) - overscan);
    const last = first + Math.ceil(sc.clientHeight / ROW_H) + overscan * 2;
    setWinRange(prev => (prev.start === first && prev.end === last ? prev : { start: first, end: last }));
  }, []);

  const onChainScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; recalcWindow(); });
  }, [recalcWindow]);

  useEffect(() => { recalcWindow(); }, [recalcWindow, rows.length, expiry?.key, filterKey]);
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  // Available underlyings not yet added as tabs
  const availableUnderlyings = UNDERLYING_GROUPS.flatMap(g => g.items)
    .filter(item => !tabs.includes(item.value));

  return (
    <div className={cn('db-oc-root deribit flex flex-col overflow-hidden select-none',
      maximized ? 'fixed inset-0 z-[100]' : 'relative h-full')}
      style={{ backgroundColor: BG_MAIN, color: 'var(--db-text)', fontVariantNumeric: 'tabular-nums' }}>

      <div ref={parentRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden pb-1">

        {/* ── Tab bar — underlying tabs + + button ─────────────────────── */}
        <div className="flex items-center gap-0.5 pt-1 px-1 shrink-0" style={{ backgroundColor: BG_HEADER }}>
          {tabs.map((u, i) => {
            const isActive = i === activeTabIdx;
            const src = sourceOf(u);
            const c = src === 'bybit' ? '#f7a600' : 'var(--db-accent)';
            return (
              <div key={u} className="relative flex items-center">
                <button
                  onClick={() => setActiveTabIdx(i)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-t-md text-[12px] font-bold transition-colors',
                    isActive
                      ? 'text-white/90'
                      : 'text-white/45 hover:text-white/65',
                  )}
                  style={{ background: isActive ? BG_CARD : 'transparent' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
                  {u}
                </button>
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2" style={{ height: 2, background: `linear-gradient(90deg, ${c} 0%, transparent 100%)` }} />
                )}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeTab(i); }}
                    className="ml-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-white/[0.08] text-white/25 hover:text-white/55 transition-colors"
                    title={`关闭 ${u}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}

          {/* + Add tab button */}
          {availableUnderlyings.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setAddMenuOpen(v => !v)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/[0.06] text-white/35 hover:text-white/60 transition-colors"
                title="添加标的"
              >
                <Plus size={14} />
              </button>
              <Popover open={addMenuOpen} onClose={() => setAddMenuOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-1 w-[200px]">
                <div className="py-2 max-h-[300px] overflow-auto">
                  {UNDERLYING_GROUPS.map(g => (
                    <div key={g.title}>
                      <div className="px-3 py-1 text-[10px] font-semibold text-white/30 uppercase">{g.title}</div>
                      {g.items.filter(item => !tabs.includes(item.value)).map(item => (
                        <button key={item.value} className="db-menu-item text-left" onClick={() => addTab(item.value)}>
                          {item.value}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </Popover>
            </div>
          )}

          <div className="flex-1" />

          <FrameControls
            maximized={maximized} onToggleMaximize={() => setMaximized(m => !m)}
            collapsed={chainCollapsed} onToggleCollapse={() => setChainCollapsed(c => !c)} />
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 py-1.5 border-b px-2" style={{ borderBottom: `1px solid ${BORDER_C}`, backgroundColor: BG_HEADER }}>
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
                    <button key={e.key} className="db-menu-item text-left" onClick={() => { setExpiryMenuOpen(false); setTabState({ expiryIdx: i }); setSelectedCell(null); }}>
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
                <button className="text-[12px] font-semibold" style={{ color: 'var(--db-accent)' }} onClick={() => setTabState({ visibleColIds: SIDE_COLS.map(c => c.id) })}>全选</button>
                <span className="text-white/25">·</span>
                <button className="text-[12px] font-semibold text-white/55 hover:text-white/80" onClick={() => setTabState({ visibleColIds: ['mark', 'bid', 'ask', 'ivBid', 'ivAsk', 'delta', 'size', 'pos'] })}>精简</button>
                <div className="ml-auto text-[12px] text-white/45">{visibleColIds.size}/{SIDE_COLS.length}</div>
              </div>
              <div className="py-2 max-h-[420px] overflow-auto">
                {SIDE_COLS.map(c => {
                  const on = visibleColIds.has(c.id);
                  return (
                    <button key={c.id} className="db-menu-item text-left" onClick={() => {
                      const ids = tabState.visibleColIds;
                      const next = ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id];
                      setTabState({ visibleColIds: next });
                    }}>
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
                <button key={k} className="db-menu-item text-left" onClick={() => { setFilterOpen(false); setTabState({ filterKey: k }); }}>
                  <span className={cn('db-check', filterKey === k && 'is-on')}>{filterKey === k && <Check size={12} className="text-black" strokeWidth={3} />}</span>{l}
                </button>
              ))}
            </Popover>
          </div>

          <button className="db-menu-btn" onClick={() => setTabState({ showDist: !showDist })}>
            <span className={cn('db-check', showDist && 'is-on')}>{showDist && <Check size={12} className="text-black" strokeWidth={3} />}</span>Dist
          </button>

          <div className="flex-1" />

          {(() => {
            const c = source === 'bybit' ? '#f7a600' : 'var(--db-accent)';
            return (
              <button
                type="button"
                onClick={() => {
                  const newSrc = source === 'bybit' ? 'deribit' : 'bybit';
                  const newU = underlyingFor(coin, newSrc);
                  setTabs(prev => prev.map((t, i) => i === activeTabIdx ? newU : t));
                }}
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

        {/* ── Chain card ────────────────────────────────────────────────── */}
        <div className="flex flex-col shrink-0 rounded-xl border" style={{ overflow: 'hidden', borderColor: BORDER_C, backgroundColor: BG_CARD, boxShadow: CARD_SHADOW, display: chainCollapsed ? 'none' : undefined }}>
          <div ref={dataRef} onScroll={onChainScroll} className="overflow-auto" style={{ maxHeight: rows.length > 0 ? Math.min(rows.length * ROW_H + 60, 600) : 300 }}>
            <div style={{ minWidth: totalWidth, position: 'relative' }}>
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
              {emBandHeight > 0 && (
                <div className="absolute left-0 w-full pointer-events-none flex justify-center z-0" style={{ top: emBandTop, height: emBandHeight }}>
                  <div className="relative h-full" style={{ width: STRIKE_W }}>
                    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-[8px]"
                      style={{ background: 'rgba(79,147,221,0.10)', borderLeft: '1px solid var(--db-accent-soft)', borderRight: '1px solid var(--db-accent-soft)', boxShadow: 'inset 0 0 10px rgba(79,147,221,0.12)' }} />
                  </div>
                </div>
              )}

              <div className="relative z-10" style={{ height: rows.length * ROW_H }}>
                {liveRows.slice(winRange.start, winRange.end).map((row, i) => {
                  const idx = winRange.start + i;
                  const selectedSide = selectedCell?.row.strike === row.strike ? selectedCell.side : undefined;
                  return (
                    <div key={row.strike} style={{ position: 'absolute', top: idx * ROW_H, left: 0, width: '100%', height: ROW_H }}>
                      <ChainRowComp row={row} cols={cols} loading={false} isEven={idx % 2 === 0}
                        selectedSide={selectedSide} ownedSide={ownedSidesByStrike.get(row.strike)}
                        onRowClick={handleRowClick} showDist={showDist} spot={spot}
                        emBandStrikeMin={emBandStrikeMin} emBandStrikeMax={emBandStrikeMax} />
                    </div>
                  );
                })}
              </div>

              <div className="absolute left-0 w-full pointer-events-none z-[5]" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-0 w-full h-[1px] -translate-y-1/2" style={{ background: 'var(--db-spot)', boxShadow: '0 0 6px rgba(79,147,221,0.85)' }} />
              </div>
              <div className="absolute left-0 w-full pointer-events-none z-20" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 h-[20px] flex items-center justify-center leading-none rounded-sm text-[13px] font-bold"
                  style={{ background: 'var(--db-spot)', color: '#0b0b0b', boxShadow: '0 2px 6px rgba(0,0,0,0.6)', border: '1px solid rgba(79,147,221,0.6)' }}>
                  {spot.toLocaleString('en-US', { maximumFractionDigits: dec })}
                </div>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>

        <div className="mt-1 overflow-auto shrink-0 w-full">
          <PositionsPanel book={book} embedded />
        </div>
      </div>

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
                <TradingPanel selected={liveSelected ?? selectedCell} coin={coin} source={source} spot={spot} dateLabel={expiry.dateLabel} dec={dec} book={book} onClose={() => setSelectedCell(null)} chainFeedKey={source === 'bybit' ? `option-chain-${coin}` : `options-${coin}`} />
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
