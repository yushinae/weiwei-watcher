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
import { useDeribitChainOptions } from '../../registry/data/deribit';
import { buildBybitExpiry, buildDeribitExpiry, dteLabel } from './chainModel';
import type { ChainExpiry, ChainRow } from './chainModel';
import { ocStore, useOCStore, coinOf, sourceOf, underlyingFor, UNDERLYING_GROUPS } from './store';
import {
  SIDE_COLS, STRIKE_W, ROW_H, BG_MAIN, BG_HEADER, BG_CARD, BORDER_C, CARD_SHADOW, optionSymbol,
} from './chainConstants';
import { Popover, ChainRowComp, ColHeaderRow, SectionRow } from './chainCells';
import type { SelectedCell } from './chainCells';
import { useGlobalOptionBook } from './optionBookStore';
import { useBookMarkFeed } from './useBookMarkFeed';
import { FrameControls, PositionsPanel, TradingPanel, type PositionMarketQuote } from './TradingPanel';
import type { SimPosition } from './simBook';
import './options-chain.css';

type FilterKey = 'all' | 'atm5' | 'atm10';
type TabState = {
  expiryIdx: number;
  expiryKey?: string;
  filterKey: FilterKey;
  showDist: boolean;
  visibleColIds: string[];
};
type PendingJump = { coin: 'BTC' | 'ETH'; expiryCompact: string; strike: number };

const DEFAULT_VISIBLE_COL_IDS = SIDE_COLS.map(c => c.id);
// expiryIdx === -1 是「未选择」哨兵：到期日列表就绪后解析为「最近的流动周」(defaultExpiryIdx)，
// 而不是第 0 档（最近、最薄、半空的 0DTE / 日内合约）。
const DEFAULT_TAB_STATE: TabState = {
  expiryIdx: -1,
  filterKey: 'all',
  showDist: false,
  visibleColIds: DEFAULT_VISIBLE_COL_IDS,
};

// 默认到期日 = 最近的「流动周」：跳过 0DTE / 日内日历（薄、半空），落在最接近 7 天的到期。
const DEFAULT_EXPIRY_TARGET_DAYS = 7;
const DEFAULT_EXPIRY_MIN_DAYS = 4;
function defaultExpiryIdx(expiries: ChainExpiry[]): number {
  if (expiries.length === 0) return 0;
  let bestIdx = -1;
  let bestScore = Infinity;
  expiries.forEach((e, i) => {
    if (e.daysToExp < DEFAULT_EXPIRY_MIN_DAYS) return;          // 跳过 0DTE / 日内薄合约
    const score = Math.abs(e.daysToExp - DEFAULT_EXPIRY_TARGET_DAYS);
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  });
  return bestIdx >= 0 ? bestIdx : expiries.length - 1;          // 全是日内（极少见）→ 退回最长期
}
// v2：默认到期日从「第 0 档」改为哨兵 -1（最近流动周），bump key 让老用户重置生效，
// 避免旧持久化的 expiryIdx:0 被当成「显式选了 0DTE」而错过新默认。
const VIEW_STATE_KEY = 'options-chain.view-state.v2';
const VALID_UNDERLYINGS = new Set(UNDERLYING_GROUPS.flatMap(g => g.items.map(item => item.value)));

type PersistedViewState = {
  tabs: string[];
  activeTabIdx: number;
  tabStates: Record<string, Partial<TabState>>;
};

function normalizeTabState(raw: Partial<TabState> | undefined): TabState {
  const visibleColIds = Array.isArray(raw?.visibleColIds)
    ? raw.visibleColIds.filter(id => DEFAULT_VISIBLE_COL_IDS.includes(id))
    : DEFAULT_VISIBLE_COL_IDS;
  return {
    expiryIdx: Number.isFinite(raw?.expiryIdx) ? Math.max(-1, Number(raw?.expiryIdx)) : DEFAULT_TAB_STATE.expiryIdx,
    expiryKey: typeof raw?.expiryKey === 'string' ? raw.expiryKey : undefined,
    filterKey: raw?.filterKey === 'atm5' || raw?.filterKey === 'atm10' ? raw.filterKey : DEFAULT_TAB_STATE.filterKey,
    showDist: !!raw?.showDist,
    visibleColIds: visibleColIds.length > 0 ? visibleColIds : DEFAULT_VISIBLE_COL_IDS,
  };
}

function loadViewState(): { tabs: string[]; activeTabIdx: number; tabStates: Record<string, TabState> } {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw) as PersistedViewState;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(u => VALID_UNDERLYINGS.has(u))
      : [];
    const safeTabs = tabs.length > 0 ? [...new Set(tabs)] : ['BTC_USDC'];
    const activeTabIdx = Math.min(Math.max(0, Number(parsed.activeTabIdx) || 0), safeTabs.length - 1);
    const tabStates: Record<string, TabState> = {};
    for (const u of safeTabs) tabStates[u] = normalizeTabState(parsed.tabStates?.[u]);
    return { tabs: safeTabs, activeTabIdx, tabStates };
  } catch {
    return { tabs: ['BTC_USDC'], activeTabIdx: 0, tabStates: {} };
  }
}

function saveViewState(tabs: string[], activeTabIdx: number, tabStates: Record<string, TabState>): void {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ tabs, activeTabIdx, tabStates }));
  } catch {
    // Ignore storage failures in private windows / restricted webviews.
  }
}

export default function OptionsChainView() {
  // ── Tabs: multiple underlying tabs, click to switch ─────────────────────
  const [initialViewState] = useState(loadViewState);
  const initialActiveUnderlying = useRef(initialViewState.tabs[initialViewState.activeTabIdx] ?? 'BTC_USDC');
  const skippedInitialNavDefault = useRef(false);
  const [tabs, setTabs] = useState<string[]>(initialViewState.tabs);
  const [activeTabIdx, setActiveTabIdx] = useState(initialViewState.activeTabIdx);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Per-tab remembered state (expiryIdx, filter, columns, dist) keyed by underlying.
  const [tabStates, setTabStates] = useState<Record<string, TabState>>(initialViewState.tabStates);

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

  useEffect(() => {
    saveViewState(tabs, activeTabIdx, tabStates);
  }, [tabs, activeTabIdx, tabStates]);

  // When the top-nav picker chooses an underlying/expiry before entering this page,
  // materialize that selection by navigating the CURRENT tab (not adding a new tab).
  // Only the "+" button can create additional tabs.
  useEffect(() => {
    if (!navUnderlying) return;
    const isInitialDefaultStoreValue =
      !skippedInitialNavDefault.current
      && navUnderlying === 'BTC_USDC'
      && navExpiryIdx <= 0
      && initialActiveUnderlying.current !== 'BTC_USDC';
    skippedInitialNavDefault.current = true;
    if (isInitialDefaultStoreValue) return;

    setTabs(prev => {
      const existingIdx = prev.indexOf(navUnderlying);
      if (existingIdx >= 0) {
        setActiveTabIdx(existingIdx);
        return prev;
      }
      // Not open — replace the current tab instead of adding a new one
      const next = [...prev];
      next[activeTabIdx] = navUnderlying;
      return next;
    });
    // nav 的 expiryIdx 0 = 点了标的表头/未选具体到期 → 用哨兵 -1 落到「最近流动周」，
    // 而非第 0 档（1H）。只有 >0 的具体到期选择才钉死。
    const navExpiry = navExpiryIdx > 0 ? navExpiryIdx : -1;
    setTabStates(prev => ({
      ...prev,
      [navUnderlying]: {
        ...(prev[navUnderlying] ?? DEFAULT_TAB_STATE),
        expiryIdx: navExpiry,
        expiryKey: undefined,
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
  const filterKey = tabState.filterKey;
  const showDist = tabState.showDist;
  const visibleColIds = useMemo(() => new Set(tabState.visibleColIds), [tabState.visibleColIds]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [chainCollapsed, setChainCollapsed] = useState(false);
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);

  const bybit = useOptionChain(coin);
  const deribitUniverse = activeUnderlying.endsWith('USDC') ? 'linear-usdc' : 'inverse';
  const deribit = useDeribitChainOptions(coin, deribitUniverse);
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

  const expiryIdx = useMemo(() => {
    if (expiries.length === 0) return 0;
    if (tabState.expiryKey) {
      const keyIdx = expiries.findIndex(e => e.key === tabState.expiryKey);
      if (keyIdx >= 0) return keyIdx;
    }
    if (tabState.expiryIdx < 0) return defaultExpiryIdx(expiries);   // 未选择 → 最近的流动周
    return Math.min(tabState.expiryIdx, expiries.length - 1);
  }, [expiries, tabState.expiryIdx, tabState.expiryKey]);
  const expiry = expiries[expiryIdx];

  useEffect(() => {
    if (expiries.length === 0 || tabState.expiryKey) return;
    const key = expiries[expiryIdx]?.key;
    if (key) setTabState({ expiryIdx, expiryKey: key });
  }, [expiries, expiryIdx, setTabState, tabState.expiryKey]);

  // Sync the shared store so the global nav "期权" hover stays in sync.
  // Skip the very first run (mount): on mount the store already holds the
  // nav menu's selection — running setSelection here would overwrite it
  // with the initial tab's underlying, trigger a useSyncExternalStore
  // forced synchronous re-render, and cause a "Maximum update depth exceeded"
  // infinite loop.
  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) { initialMount.current = false; return; }
    ocStore.setSelection(activeUnderlying, expiryIdx);
  }, [activeUnderlying, expiryIdx]);
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
    const withTicks = Object.keys(liveTicks).length === 0 ? rows : rows.map(r => {
      const c = liveTicks[`C-${r.strike}`];
      const p = liveTicks[`P-${r.strike}`];
      if (!c && !p) return r;
      return { ...r, call: c ? { ...r.call, ...c } : r.call, put: p ? { ...r.put, ...p } : r.put };
    });
    if (!expiry || book.positions.length === 0) return withTicks;

    const posBySymbol = new Map<string, number>();
    for (const p of book.positions) {
      const signedQty = p.side === 'long' ? p.qty : -p.qty;
      posBySymbol.set(p.symbol, (posBySymbol.get(p.symbol) ?? 0) + signedQty);
    }

    return withTicks.map(r => {
      const callPos = posBySymbol.get(optionSymbol(coin, expiry.dateLabel, r.strike, 'C'));
      const putPos = posBySymbol.get(optionSymbol(coin, expiry.dateLabel, r.strike, 'P'));
      if (callPos === undefined && putPos === undefined) return r;
      return {
        ...r,
        call: callPos === undefined ? r.call : { ...r.call, pos: callPos },
        put: putPos === undefined ? r.put : { ...r.put, pos: putPos },
      };
    });
  }, [rows, liveTicks, book.positions, coin, expiry]);

  const liveSelected = useMemo<SelectedCell | null>(() => {
    if (!selectedCell) return null;
    const liveRow = liveRows.find(r => r.strike === selectedCell.row.strike) ?? selectedCell.row;
    return { row: liveRow, side: selectedCell.side };
  }, [selectedCell, liveRows]);

  const atmIV = expiry?.atmIV ?? 0;
  const dec = spot < 1 ? 6 : spot < 100 ? 4 : 2;
  const spotDp = dec;
  const dte = expiry ? dteLabel(expiry.daysToExp, expiry.expiryTs) : '—';

  const marketQuotes = useMemo(() => {
    const next = new Map<string, PositionMarketQuote>();
    if (!expiry) return next;
    for (const r of liveRows) {
      next.set(optionSymbol(coin, expiry.dateLabel, r.strike, 'C'), { ...r.call, source, dec });
      next.set(optionSymbol(coin, expiry.dateLabel, r.strike, 'P'), { ...r.put, source, dec });
    }
    return next;
  }, [liveRows, coin, expiry, source, dec]);

  const updateMarks = book.updateMarks;
  useBookMarkFeed(book.positions, updateMarks);
  useEffect(() => {
    if (!expiry) return;
    const marks: Record<string, number> = {};
    for (const r of liveRows) {
      if (r.call.mark > 0) marks[optionSymbol(coin, expiry.dateLabel, r.strike, 'C')] = r.call.mark;
      if (r.put.mark > 0) marks[optionSymbol(coin, expiry.dateLabel, r.strike, 'P')] = r.put.mark;
    }
    updateMarks(marks);
  }, [expiry, liveRows, coin, updateMarks]);

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

  const jumpToSymbol = useCallback((symbol: string, position?: SimPosition) => {
    const m = symbol.match(/^(BTC|ETH)-([0-9]{1,2}[A-Z]{3}[0-9]{4})-([0-9.]+)-(C|P)$/);
    if (!m) return;
    const [, jumpCoin, expiryCompact, strikeRaw] = m;
    const jumpSource = position?.source ?? source;
    const preferredDeribitUnderlying = position?.instrument?.startsWith(`${jumpCoin}_USDC-`)
      ? `${jumpCoin}_USDC`
      : jumpCoin;
    const jumpUnderlying = coinOf(activeUnderlying) === jumpCoin && sourceOf(activeUnderlying) === jumpSource
      ? activeUnderlying
      : jumpSource === 'deribit'
        ? preferredDeribitUnderlying
        : underlyingFor(jumpCoin as 'BTC' | 'ETH', jumpSource);
    const targetTabIdx = tabs.indexOf(jumpUnderlying);
    if (targetTabIdx >= 0) {
      setActiveTabIdx(targetTabIdx);
    } else {
      setTabs(prev => [...prev, jumpUnderlying]);
      setActiveTabIdx(tabs.length);
    }
    setPendingJump({ coin: jumpCoin as 'BTC' | 'ETH', expiryCompact, strike: Number(strikeRaw) });
    setSelectedCell(null);
    setChainCollapsed(false);
  }, [activeUnderlying, source, tabs]);

  useEffect(() => {
    if (!pendingJump || pendingJump.coin !== coin || expiries.length === 0) return;
    const idx = expiries.findIndex(e => e.dateLabel.replace(/\s+/g, '').toUpperCase() === pendingJump.expiryCompact);
    if (idx < 0) return;
    if (idx !== expiryIdx) {
      setTabState({ expiryIdx: idx, expiryKey: expiries[idx]?.key, filterKey: 'all' });
      return;
    }

    const sc = dataRef.current;
    const rowIdx = rows.findIndex(r => r.strike === pendingJump.strike);
    if (rowIdx < 0 && filterKey !== 'all' && allRows.some(r => r.strike === pendingJump.strike)) {
      setTabState({ filterKey: 'all' });
      return;
    }
    if (!sc || rowIdx < 0) return;
    const left = colsWidth + STRIKE_W / 2 - sc.clientWidth / 2;
    const top = rowIdx * ROW_H + 70 - sc.clientHeight / 2;
    sc.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
    setPendingJump(null);
  }, [pendingJump, coin, expiries, expiryIdx, rows, allRows, filterKey, colsWidth, setTabState]);

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
              {expiry && <span className="font-mono font-bold" style={{ color: 'var(--db-accent)' }}>{expiry.dateLabel}</span>}
              <ChevronDown size={14} className="text-white/50" />
            </button>
            <Popover open={expiryMenuOpen} onClose={() => setExpiryMenuOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[136px]">
              <div className="py-2 max-h-[360px] overflow-auto">
                {expiries.length === 0 && <div className="px-3 py-2 text-[12px] text-white/35">加载中…</div>}
                {expiries.map((e, i) => {
                  const on = i === expiryIdx;
                  return (
                    <button key={e.key} className="db-menu-item text-left" onClick={() => { setExpiryMenuOpen(false); setTabState({ expiryIdx: i, expiryKey: e.key }); setSelectedCell(null); }}>
                      <span className={cn('db-check', on && 'is-on')}>{on && <Check size={12} className="text-black" strokeWidth={3} />}</span>
                      <span className="font-mono font-semibold">{e.dateLabel}</span>
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
            <Popover open={columnsOpen} onClose={() => setColumnsOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[200px]">
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
            <Popover open={filterOpen} onClose={() => setFilterOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[150px]">
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
                      style={{ background: 'rgba(247,166,0,0.10)', borderLeft: '1px solid var(--db-accent-soft)', borderRight: '1px solid var(--db-accent-soft)', boxShadow: 'inset 0 0 10px rgba(247,166,0,0.12)' }} />
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
                <div className="absolute left-0 w-full h-[1px] -translate-y-1/2" style={{ background: 'var(--db-spot)', boxShadow: '0 0 6px rgba(255,156,46,0.65)' }} />
              </div>
              <div className="absolute left-0 w-full pointer-events-none z-20" style={{ top: `${spotY}px`, height: '0px' }}>
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 h-[20px] flex items-center justify-center leading-none rounded-sm text-[13px] font-bold"
                  style={{ background: 'var(--db-spot)', color: '#0b0b0b', boxShadow: '0 2px 6px rgba(0,0,0,0.6)', border: '1px solid rgba(247,166,0,0.55)' }}>
                  {spot.toLocaleString('en-US', { maximumFractionDigits: dec })}
                </div>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>

        <div className="mt-1 overflow-auto shrink-0 w-full">
          <PositionsPanel book={book} embedded onSymbolClick={jumpToSymbol} marketQuotes={marketQuotes} />
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
                aria-label={`${coin}-${selectedCell.row.strike}-${selectedCell.side === 'call' ? 'C' : 'P'} 期权下单面板`}
                initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="rounded-[10px] overflow-hidden border pointer-events-auto"
                style={{ width: '88vw', height: '78vh', maxWidth: 1260, borderColor: BORDER_C, boxShadow: '0 32px 80px rgba(0,0,0,0.75)' }}>
                <TradingPanel selected={liveSelected ?? selectedCell} coin={coin} source={source} spot={spot} daysToExp={expiry.daysToExp} dateLabel={expiry.dateLabel} dec={dec} book={book} onClose={() => setSelectedCell(null)} chainFeedKey={source === 'bybit' ? `option-chain-${coin}` : deribitUniverse === 'linear-usdc' ? `deribit-usdc-chain-${coin}` : `deribit-chain-${coin}`} marketQuotes={marketQuotes} />
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
