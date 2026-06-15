// ═══════════════════════════════════════════════════════════════════════════════
// Trading panel — the click-through trade ticket, order book, greeks, and the
// shared positions / orders / history table.
//
//   FrameControls  — 放大 / 拉伸 / 关闭 window chrome (placeholders for the widget shell)
//   PositionsPanel — 仓位 / 未结订单 / 订单历史 / 交易历史 (page card + modal footer)
//   FlashValue     — green-up / red-down flash so live WS ticks are visible
//   TradingPanel   — the full trade modal body
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { ChevronDown, X, Check, Maximize2, Minimize2, ChevronsUpDown, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useEscapeKey } from '../../lib/useEscapeKey';
import type { Coin, DataSource, Side } from './chainModel';
import { fillAgainstBook, type DepthBook, type DepthLevel, type SimPosition } from './simBook';
import { bsIV } from '../../registry/lib/bs-math';
import type { GlobalOptionBook } from './optionBookStore';
import {
  createBybitLiveAdapter,
  createDeribitLiveAdapter,
  createSimExecutionAdapter,
  runRiskGate,
  type ExecutionAdapter,
  type ExecutionMode,
  type TimeInForce,
  type TradeIntent,
} from './execution';
import { useOptionDepth, depthFeedKey } from './optionDepth';
import { Popover } from './chainCells';
import type { SelectedCell } from './chainCells';
import {
  BORDER_C, TABNUM, fmtGamma5, optionSymbol,
} from './chainConstants';
import FreshnessTag from '../../components/FreshnessTag';
import { useFreshness } from '../../registry/data/freshness';
import type { CheckLevel } from './preTradeChecks';
import { soundOrderError } from './orderSounds';
import { requestAccountPositionsRefresh } from '../accounts/positionRefresh';

// ─────────────────────────────────────────────────────────────────────────────
// Positions panel — 仓位 / 未结订单 / 订单历史 / 交易历史 (shared: page + trade modal)
// ─────────────────────────────────────────────────────────────────────────────

const BORDER = `1px solid ${BORDER_C}`;
type BookTab = 'position' | 'open' | 'history' | 'trades';

const POS_GRID = 'grid grid-cols-[minmax(180px,1.35fr)_64px_82px_82px_82px_86px_64px_64px_64px_64px]';
const POSITION_GRID = 'grid grid-cols-[minmax(180px,1.35fr)_64px_82px_82px_82px_86px_64px_64px_64px_64px_98px]';
const OPEN_GRID = 'grid grid-cols-[minmax(190px,1.4fr)_82px_78px_72px_100px_136px_96px_82px]';
const POS_TABS: { k: BookTab; l: string }[] = [
  { k: 'position', l: '仓位' },
  { k: 'open', l: '未结' },
  { k: 'history', l: '历史' },
  { k: 'trades', l: '成交' },
];
const PANEL_BG = '#17181E';
const TILE_BG = '#2B2D35';
const TILE_HOVER = '#3A3B40';
const SELECTED_BG = '#3A3F40';
const TABLE_HEAD_BG = '#121318';
const NAV_BG = '#15161D';
const SUBTLE_LINE = 'rgba(255,255,255,0.06)';
const ORANGE = '#ff9c2e';
const EXEC_MODE_KEY = 'options.executionMode';
const LIVE_TESTNET = false;
const LIVE_ARMED = true;

function storageGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

function getDeribitCredentials() {
  const clientId = import.meta.env.VITE_DERIBIT_API_KEY?.trim();
  const clientSecret = import.meta.env.VITE_DERIBIT_API_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function initialExecutionMode(): ExecutionMode {
  return storageGet(EXEC_MODE_KEY, 'sim') === 'live' ? 'live' : 'sim';
}

const fmtSigned = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
export type PositionMarketQuote = Pick<Side, 'bid' | 'ask' | 'mark' | 'iv' | 'delta' | 'gamma' | 'theta' | 'vega' | 'instrument'> & {
  source: DataSource;
  dec: number;
};

// Window-frame controls (最大化 / 收起) — top-right of a component card.
export function FrameControls({ maximized, onToggleMaximize, collapsed, onToggleCollapse }: {
  maximized?: boolean; onToggleMaximize?: () => void;
  collapsed?: boolean; onToggleCollapse?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {onToggleMaximize && (
        <button type="button" className="db-frame-iconbtn" onClick={onToggleMaximize}
          aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} aria-pressed={!!maximized}>
          {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      )}
      {onToggleCollapse && (
        <button type="button" className="db-frame-iconbtn" onClick={onToggleCollapse}
          aria-label={collapsed ? '展开' : '收起'} title={collapsed ? '展开' : '收起'} aria-expanded={!collapsed}>
          <ChevronsUpDown size={15} />
        </button>
      )}
    </div>
  );
}

export function PositionsPanel({ book, style, className, embedded, onSymbolClick, marketQuotes }: {
  book: GlobalOptionBook; style?: React.CSSProperties; className?: string; embedded?: boolean;
  onSymbolClick?: (symbol: string, position?: SimPosition) => void;
  marketQuotes?: Map<string, PositionMarketQuote>;
}) {
  const [btab, setBtab] = useState<BookTab>('position');
  const [collapsed, setCollapsed] = useState(() => !embedded);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editQty, setEditQty] = useState('');
  const [closingPosition, setClosingPosition] = useState<SimPosition | null>(null);
  const [closeMode, setCloseMode] = useState<'limit' | 'market'>('limit');
  const [closePrice, setClosePrice] = useState('');
  const [closeQty, setCloseQty] = useState('');
  const { positions, openOrders, orderHistory, fills, cancelOrder, editOrder, placeOrder } = book;
  const editingOrder = useMemo(
    () => openOrders.find(o => o.id === editingOrderId) ?? null,
    [openOrders, editingOrderId],
  );
  const liveClosingPosition = useMemo(() => (
    closingPosition
      ? positions.find(p => p.id === closingPosition.id) ?? positions.find(p => p.symbol === closingPosition.symbol) ?? closingPosition
      : null
  ), [closingPosition, positions]);
  const closingQuote = liveClosingPosition ? marketQuotes?.get(liveClosingPosition.symbol) : undefined;
  const rawClosingDepth = useOptionDepth(closingQuote?.source ?? 'bybit', closingQuote?.instrument);
  const closingBook = useMemo<DepthBook | null>(() => {
    if (!rawClosingDepth || (rawClosingDepth.bids.length === 0 && rawClosingDepth.asks.length === 0)) return null;
    const rawAsk = rawClosingDepth.asks[0]?.price;
    const rawBid = rawClosingDepth.bids[0]?.price;
    let factor = 1;
    if (closingQuote?.ask != null && rawAsk) factor = closingQuote.ask / rawAsk;
    else if (closingQuote?.bid != null && rawBid) factor = closingQuote.bid / rawBid;
    const conv = (l: DepthLevel) => ({ price: l.price * factor, size: l.size });
    return {
      bids: rawClosingDepth.bids.map(conv),
      asks: rawClosingDepth.asks.map(conv),
    };
  }, [rawClosingDepth, closingQuote?.ask, closingQuote?.bid]);
  const closePercent = liveClosingPosition?.qty
    ? Math.min(100, Math.max(0, ((Number(closeQty) || 0) / liveClosingPosition.qty) * 100))
    : 0;
  useEscapeKey(editingOrder != null, () => setEditingOrderId(null));
  useEscapeKey(closingPosition != null, () => setClosingPosition(null));
  const startEditOrder = (order: (typeof openOrders)[number]) => {
    setEditingOrderId(order.id);
    setEditPrice(String(order.price));
    setEditQty(String(order.qty));
  };
  const confirmEditOrder = () => {
    if (!editingOrder || !editOrder) return;
    const nextPrice = Number(editPrice);
    const nextQty = Number(editQty);
    if (!(nextPrice > 0) || !(nextQty > 0)) return;
    editOrder(editingOrder.id, nextPrice, nextQty);
    setEditingOrderId(null);
  };
  const startClosePosition = (position: SimPosition, mode: 'limit' | 'market') => {
    const quote = marketQuotes?.get(position.symbol);
    setClosingPosition(position);
    setCloseMode(mode);
    setClosePrice(String(quote?.mark ?? position.markPrice));
    setCloseQty(String(position.qty));
  };
  const confirmClosePosition = () => {
    const position = liveClosingPosition;
    if (!position) return;
    const nextPrice = Number(closePrice);
    const nextQty = Math.min(Number(closeQty), position.qty);
    if (!(nextQty > 0) || (closeMode === 'limit' && !(nextPrice > 0))) return;
    const sign = position.side === 'long' ? 1 : -1;
    const mark = closingQuote?.mark ?? position.markPrice;
    placeOrder({
      side: position.side === 'long' ? 'sell' : 'buy',
      type: closeMode,
      symbol: position.symbol,
      qty: nextQty,
      price: closeMode === 'market' ? mark : nextPrice,
      mark,
      delta: (closingQuote?.delta ?? position.delta / sign),
      gamma: (closingQuote?.gamma ?? position.gamma / sign),
      theta: (closingQuote?.theta ?? position.theta / sign),
      vega: (closingQuote?.vega ?? position.vega / sign),
      source: closingQuote?.source ?? position.source,
      instrument: closingQuote?.instrument ?? position.instrument,
      book: closingBook ?? undefined,
    });
    setClosingPosition(null);
  };

  // ── Summary stats for the header ─────────────────────────────────────
  const grossValue = useMemo(
    () => positions.reduce((s, p) => s + p.markPrice * p.qty, 0),
    [positions],
  );
  const totalDelta = useMemo(
    () => positions.reduce((s, p) => s + p.delta, 0),
    [positions],
  );
  const totalPnL = useMemo(
    () => positions.reduce((s, p) => s + p.unrealizedPnL, 0),
    [positions],
  );
  const totalGamma = useMemo(
    () => positions.reduce((s, p) => s + p.gamma, 0),
    [positions],
  );
  const totalTheta = useMemo(
    () => positions.reduce((s, p) => s + p.theta, 0),
    [positions],
  );
  const totalVega = useMemo(
    () => positions.reduce((s, p) => s + p.vega, 0),
    [positions],
  );
  const tabCounts: Record<BookTab, number> = {
    position: positions.length,
    open: openOrders.length,
    history: orderHistory.length,
    trades: fills.length,
  };
  const hasData = positions.length > 0 || openOrders.length > 0 || orderHistory.length > 0 || fills.length > 0;

  const SummaryMetric = ({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'orange' }) => (
    <div className="min-w-[82px] rounded-[6px] px-2.5 py-1.5 transition-colors hover:bg-[#3A3B40]" style={{ background: TILE_BG }}>
      <div className="text-[9px] uppercase tracking-[0.06em] text-white/40">{label}</div>
      <div
        className={cn('mt-0.5 font-mono text-[12px] font-bold tabular-nums', !tone && 'text-white/82')}
        style={{
          color: tone === 'up' ? 'var(--db-up)' : tone === 'down' ? 'var(--db-down)' : tone === 'orange' ? 'var(--db-accent)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );

  const tabBar = (
    <div className="flex items-center gap-1 rounded-[6px] p-[3px]" style={{ background: TILE_BG }}>
      {POS_TABS.map(t => {
        const on = btab === t.k;
        return (
          <button key={t.k} onClick={() => { setBtab(t.k); setCollapsed(false); }}
            className={cn(
              'h-7 min-w-[56px] px-2.5 rounded-[6px] text-[11px] font-semibold transition-colors whitespace-nowrap active:translate-y-px',
              on ? 'text-[var(--db-accent)]' : 'text-white/55 hover:text-white/85',
            )}
            style={{ background: on ? SELECTED_BG : 'transparent' }}
            onMouseEnter={e => {
              if (!on) e.currentTarget.style.background = TILE_HOVER;
            }}
            onMouseLeave={e => {
              if (!on) e.currentTarget.style.background = 'transparent';
            }}
          >
            {t.l}
            {tabCounts[t.k] > 0 && <span className="ml-1 text-[9px] opacity-65">{tabCounts[t.k]}</span>}
          </button>
        );
      })}
    </div>
  );

  const headerRow = (
    <div className={cn(POS_GRID, 'sticky top-0 z-[2] min-w-[840px] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em]')}
      style={{ background: TABLE_HEAD_BG, color: 'rgba(255,255,255,0.45)' }}>
      <div>合约</div>
      <div className="text-right">数量</div>
      <div className="text-right">价值</div>
      <div className="text-right">均价</div>
      <div className="text-right">标记</div>
      <div className="text-right">损益/状态</div>
      <div className="text-right">Δ</div>
      <div className="text-right">Γ</div>
      <div className="text-right">Θ</div>
      <div className="text-right">ν</div>
    </div>
  );
  const positionHeaderRow = (
    <div className={cn(POSITION_GRID, 'sticky top-0 z-[2] min-w-[940px] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em]')}
      style={{ background: TABLE_HEAD_BG, color: 'rgba(255,255,255,0.45)' }}>
      <div>合约</div>
      <div className="text-right">数量</div>
      <div className="text-right">价值</div>
      <div className="text-right">均价</div>
      <div className="text-right">标记</div>
      <div className="text-right">损益/状态</div>
      <div className="text-right">Δ</div>
      <div className="text-right">Γ</div>
      <div className="text-right">Θ</div>
      <div className="text-right">ν</div>
      <div className="sticky right-0 z-[3] bg-[#121318] text-center shadow-[-10px_0_14px_rgba(0,0,0,0.22)]">平仓</div>
    </div>
  );

  const EmptyState = ({ label }: { label: string }) => (
    <div className="flex h-[118px] items-center justify-center">
      <div className="rounded-[4px] px-4 py-2 text-[12px] font-semibold text-white/38" style={{ background: TILE_BG }}>
        {label}
      </div>
    </div>
  );

  const rowCls = cn(POS_GRID, 'min-w-[840px] px-3 py-2 text-[11px] transition-colors border-t border-white/[0.035] hover:bg-[#3A3B40]');
  const positionRowCls = cn(POSITION_GRID, 'min-w-[946px] px-3 py-2 text-[11px] border-t border-white/[0.035]');
  const openRowCls = cn(OPEN_GRID, 'min-w-[980px] px-3 py-2 text-[11px] border-t border-white/[0.035]');
  const actionPillCls = 'h-7 rounded-full bg-[#2B2D35] px-2.5 text-[11px] font-extrabold text-white/88 transition-colors hover:bg-[#555A5C] active:translate-y-px';
  const inlineEditButtonCls = 'ml-1 inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/75';

  const table = (
    <div className="min-w-0 w-full">
      {btab === 'position' ? positionHeaderRow : btab !== 'open' && headerRow}
      {btab === 'position' && positions.length === 0 && <EmptyState label="暂无持仓" />}
      {btab === 'position' && positions.map(p => (
        <div key={p.id} className={positionRowCls}>
          <div className="min-w-0">
            {onSymbolClick ? (
              <button
                type="button"
                onClick={() => onSymbolClick(p.symbol, p)}
                className="block max-w-full truncate text-left font-mono font-bold text-white/88 transition-colors hover:text-[var(--db-accent)]"
                title={`跳转到 ${p.symbol}`}
              >
                {p.symbol}
              </button>
            ) : (
              <div className="truncate font-mono font-bold text-white/88">{p.symbol}</div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="rounded px-1.5 py-[1px] text-[9px] font-bold" style={{
                background: p.side === 'long' ? 'rgba(36,174,100,0.12)' : 'rgba(239,69,74,0.12)',
                color: p.side === 'long' ? 'var(--db-up)' : 'var(--db-down)',
              }}>{p.side === 'long' ? 'LONG' : 'SHORT'}</span>
              <span className="text-[10px] text-white/35">模拟仓位</span>
            </div>
          </div>
          <div className="self-center text-right font-mono text-white/82">{p.qty.toFixed(2)}</div>
          <div className="self-center text-right font-mono text-white/55">{(p.markPrice * p.qty).toFixed(2)}</div>
          <div className="self-center text-right font-mono text-white/55">{p.avgEntryPrice.toFixed(2)}</div>
          <div className="self-center text-right font-mono text-white/82">{p.markPrice.toFixed(2)}</div>
          <div className="self-center text-right font-mono font-bold" style={{ color: p.unrealizedPnL >= 0 ? 'var(--db-up)' : 'var(--db-down)' }}>{fmtSigned(p.unrealizedPnL)}</div>
          <div className="self-center text-right font-mono text-white/55">{p.delta.toFixed(3)}</div>
          <div className="self-center text-right font-mono text-white/55">{p.gamma.toFixed(4)}</div>
          <div className="self-center text-right font-mono text-white/55">{p.theta.toFixed(2)}</div>
          <div className="self-center text-right font-mono text-white/55">{p.vega.toFixed(2)}</div>
          <div className="sticky right-0 flex items-center justify-center gap-1 self-stretch bg-[#17181E] shadow-[-10px_0_14px_rgba(0,0,0,0.20)]">
            <button
              type="button"
              onClick={() => startClosePosition(p, 'limit')}
              className={actionPillCls}
            >
              限价
            </button>
            <button
              type="button"
              onClick={() => startClosePosition(p, 'market')}
              className={actionPillCls}
            >
              市价
            </button>
          </div>
        </div>
      ))}
      {btab === 'open' && (
        <>
          <div className={cn(OPEN_GRID, 'sticky top-0 z-[3] min-w-[980px] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.04em]')}
            style={{ background: TABLE_HEAD_BG, color: 'rgba(255,255,255,0.45)' }}>
            <div>交易对</div>
            <div>工具</div>
            <div>订单类型</div>
            <div>方向</div>
            <div className="text-right">订单价格</div>
            <div className="text-right">已成交/订单数量</div>
            <div className="text-right">订单价值</div>
            <div className="sticky right-0 bg-[#121318] text-center">操作</div>
          </div>
          {openOrders.length === 0 && <EmptyState label="暂无未结订单" />}
          {openOrders.map(o => (
            <div key={o.id} className={openRowCls}>
              <div className="min-w-0 self-center">
                <div className="truncate font-mono font-bold text-white/88">{o.symbol}</div>
                <div className="mt-0.5 text-[10px] text-white/35">{new Date(o.createdAt).toLocaleTimeString()}</div>
              </div>
              <div className="self-center font-semibold text-white/70">USDC 期权</div>
              <div className="self-center font-semibold text-white/70">{o.type === 'limit' ? '限价单' : o.type === 'stop' ? '止损' : '市价单'}</div>
              <div className="self-center font-mono font-bold" style={{ color: o.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{o.side === 'buy' ? '买入' : '卖出'}</div>
              <div className="self-center text-right font-mono">
                <span className="font-bold text-white/88">{o.price.toFixed(2)}</span>
                <button type="button" className={inlineEditButtonCls} onClick={() => startEditOrder(o)} title="编辑价格">
                  <Pencil size={12} />
                </button>
              </div>
              <div className="self-center text-right font-mono">
                <span className="font-bold text-white/88">0.00/{o.qty.toFixed(2)}</span>
                <button type="button" className={inlineEditButtonCls} onClick={() => startEditOrder(o)} title="编辑数量">
                  <Pencil size={12} />
                </button>
              </div>
              <div className="self-center text-right font-mono font-semibold text-white/70">{(o.price * o.qty).toFixed(2)}</div>
              <div className="sticky right-0 flex items-center justify-center self-stretch bg-[#17181E]">
                <button onClick={() => cancelOrder(o.id)} className={cn(actionPillCls, 'px-3')}>取消</button>
              </div>
            </div>
          ))}
        </>
      )}
      {btab === 'history' && orderHistory.length === 0 && <EmptyState label="暂无历史订单" />}
      {btab === 'history' && orderHistory.slice(-30).reverse().map(o => (
        <div key={o.id} className={rowCls}>
          <div className="truncate font-mono font-bold text-white/85">{o.symbol}</div>
          <div className="text-right font-mono text-white/82">{o.qty.toFixed(2)}</div>
          <div className="text-right font-mono text-white/25">—</div>
          <div className="text-right font-mono text-white/55">{(o.filledPrice ?? o.price).toFixed(2)}</div>
          <div className="text-right font-mono text-white/25">—</div>
          <div className="text-right font-mono" style={{ color: o.status === 'filled' ? 'var(--db-up)' : o.status === 'cancelled' ? 'rgba(255,255,255,0.42)' : 'var(--db-warn)' }}>{o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已取消' : '待成交'}</div>
          <div className="text-right font-mono text-white/40">{new Date(o.createdAt).toLocaleTimeString()}</div>
          <div className="text-right font-mono text-white/25">—</div><div className="text-right font-mono text-white/25">—</div><div className="text-right font-mono text-white/25">—</div>
        </div>
      ))}
      {btab === 'trades' && fills.length === 0 && <EmptyState label="暂无成交记录" />}
      {btab === 'trades' && fills.slice(-30).reverse().map(f => (
        <div key={f.id} className={rowCls}>
          <div className="truncate font-mono font-bold text-white/85">{f.symbol}</div>
          <div className="text-right font-mono text-white/82">{f.qty.toFixed(2)}</div>
          <div className="text-right font-mono text-white/55">{(f.price * f.qty).toFixed(2)}</div>
          <div className="text-right font-mono text-white/55">{f.price.toFixed(2)}</div>
          <div className="text-right font-mono text-white/40">{f.fee.toFixed(4)}</div>
          <div className="text-right font-mono" style={{ color: f.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{f.side === 'buy' ? '买入' : '卖出'}</div>
          <div className="text-right font-mono text-white/40">{new Date(f.timestamp).toLocaleTimeString()}</div>
          <div className="text-right font-mono text-white/25">—</div><div className="text-right font-mono text-white/25">—</div><div className="text-right font-mono text-white/25">—</div>
        </div>
      ))}
    </div>
  );

  const summary = (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
      <SummaryMetric label="仓位" value={String(positions.length)} />
      <SummaryMetric label="名义价值" value={grossValue.toFixed(2)} />
      <SummaryMetric label="未实现 PnL" value={fmtSigned(totalPnL)} tone={totalPnL > 0 ? 'up' : totalPnL < 0 ? 'down' : undefined} />
      <SummaryMetric label="净 Delta" value={fmtSigned(totalDelta, 3)} tone={totalDelta > 0 ? 'up' : totalDelta < 0 ? 'down' : undefined} />
      <SummaryMetric label="Gamma" value={totalGamma.toFixed(4)} />
      <SummaryMetric label="Theta" value={totalTheta.toFixed(2)} tone={totalTheta < 0 ? 'down' : totalTheta > 0 ? 'up' : undefined} />
      <SummaryMetric label="Vega" value={totalVega.toFixed(2)} tone="orange" />
    </div>
  );

  const editOrderModal = editingOrder && (
    <>
      <div className="fixed inset-0 z-[310] bg-black/65 backdrop-blur-[4px]" onClick={() => setEditingOrderId(null)} />
      <div className="fixed inset-0 z-[311] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[420px] rounded-[8px] p-5 pointer-events-auto shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style={{ background: '#17181E' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[18px] font-extrabold text-white/94">编辑订单</div>
              <div className="mt-1 font-mono text-[12px] font-semibold text-white/42">{editingOrder.symbol}</div>
            </div>
            <button
              type="button"
              onClick={() => setEditingOrderId(null)}
              className="flex h-8 w-8 items-center justify-center rounded-[4px] text-white/45 transition-colors hover:bg-[#3A3B40] hover:text-white/80"
              aria-label="关闭编辑订单"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-5">
            <button type="button" className="text-[15px] font-extrabold text-[var(--db-accent)]">限价单</button>
            <button type="button" className="text-[15px] font-extrabold text-white/35" title="IV 编辑暂未接入模拟撮合">IV</button>
          </div>

          <div className="mt-4 space-y-2.5">
            <label className="block rounded-[4px] px-3 py-1.5" style={{ background: TILE_BG }}>
              <div className="text-[11px] font-bold text-white/72">价格</div>
              <div className="mt-1 flex items-center gap-3">
                <input
                  value={editPrice}
                  onChange={e => setEditPrice(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[17px] font-extrabold text-white/92 outline-none"
                  inputMode="decimal"
                />
                <span className="text-[13px] font-extrabold text-white/80">USDC</span>
              </div>
            </label>

            <label className="block rounded-[4px] px-3 py-1.5 ring-1 ring-inset ring-white/[0.06]" style={{ background: '#1E2026' }}>
              <div className="text-[11px] font-bold text-white/72">IV</div>
              <div className="mt-1 flex items-center gap-3">
                <input
                  value=""
                  disabled
                  placeholder="—"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[17px] font-extrabold text-white/35 outline-none"
                />
                <span className="text-[13px] font-extrabold text-white/80">%</span>
              </div>
            </label>

            <label className="block rounded-[4px] px-3 py-1.5" style={{ background: TILE_BG }}>
              <div className="text-[11px] font-bold text-white/72">数量</div>
              <div className="mt-1 flex items-center gap-3">
                <input
                  value={editQty}
                  onChange={e => setEditQty(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[17px] font-extrabold text-white/92 outline-none"
                  inputMode="decimal"
                />
                <span className="text-[13px] font-extrabold text-white/80">{editingOrder.symbol.startsWith('ETH') ? 'ETH' : 'BTC'}</span>
              </div>
            </label>

            <div className="grid grid-cols-[1fr_auto] gap-y-1.5 px-0.5 text-[11px] font-semibold">
              <span className="text-white/45">订单价值</span>
              <span className="font-mono text-white/85">{((Number(editPrice) || 0) * (Number(editQty) || 0)).toFixed(2)} USDC</span>
              <span className="text-white/45">原订单</span>
              <span className="font-mono text-white/55">{editingOrder.price.toFixed(2)} / {editingOrder.qty.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={confirmEditOrder}
              className="h-10 rounded-full text-[14px] font-extrabold text-black transition-opacity hover:opacity-90 active:translate-y-px"
              style={{ background: ORANGE }}
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => setEditingOrderId(null)}
              className="h-10 rounded-full text-[14px] font-extrabold text-white/86 ring-1 ring-inset ring-white/25 transition-colors hover:bg-[#3A3B40] active:translate-y-px"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </>
  );
  const closePositionModal = closingPosition && (() => {
    const position = liveClosingPosition ?? closingPosition;
    const liveMark = closingQuote?.mark ?? position.markPrice;
    const liveBid = closingQuote?.bid ?? null;
    const liveAsk = closingQuote?.ask ?? null;
    const dec = closingQuote?.dec ?? 2;
    const qty = Math.min(Number(closeQty) || 0, position.qty);
    const isLimitClose = closeMode === 'limit';
    const orderTypeLabel = isLimitClose ? '限价' : '市价';
    const px = isLimitClose ? (Number(closePrice) || 0) : liveMark;
    const sign = position.side === 'long' ? 1 : -1;
    const pnl = (px - position.avgEntryPrice) * qty * sign;
    const coin = position.symbol.startsWith('ETH') ? 'ETH' : 'BTC';
    const actionText = position.side === 'long' ? '卖出平多' : '买入平空';
    const actionColor = position.side === 'long' ? 'var(--db-down)' : 'var(--db-up)';
    const pnlText = pnl >= 0 ? '预计盈利为' : '预计亏损为';
    const stepPx = Math.max(liveMark * 0.003, dec >= 4 ? 0.001 : 0.1);
    const fallbackAskBase = liveAsk ?? liveMark + stepPx;
    const fallbackBidBase = liveBid ?? Math.max(0, liveMark - stepPx);
    const askBaseRows = closingBook?.asks.length
      ? closingBook.asks.slice(0, 4).reverse()
      : [3, 2, 1, 0].map((offset, idx) => ({ price: fallbackAskBase + offset * stepPx, size: Math.max(qty, position.qty) * (idx + 1) * 0.45 }));
    const bidBaseRows = closingBook?.bids.length
      ? closingBook.bids.slice(0, 4)
      : [0, 1, 2, 3].map((offset, idx) => ({ price: Math.max(0, fallbackBidBase - offset * stepPx), size: Math.max(qty, position.qty) * (idx + 1) * 0.45 }));
    const withTotals = (levels: DepthLevel[]) => {
      let total = 0;
      return levels.map(level => {
        total += level.size;
        return { ...level, total };
      });
    };
    const askRows = withTotals(askBaseRows);
    const bidRows = withTotals(bidBaseRows);
    const highPx = Math.max(...askRows.map(r => r.price), liveAsk ?? 0, liveMark);
    const lowPx = Math.min(...bidRows.map(r => r.price), liveBid ?? liveMark, liveMark);
    const currentIv = closingQuote?.iv ?? 0;
    const sliderValue = Math.min(100, Math.max(0, closePercent));
    const onClosePercentChange = (pctRaw: string) => {
      const pct = Number(pctRaw);
      const nextQty = position.qty * (Number.isFinite(pct) ? pct : 0) / 100;
      setCloseQty(nextQty <= 0 ? '0' : nextQty.toFixed(2));
    };
    const bumpCloseQty = (delta: number) => {
      const nextQty = Math.min(position.qty, Math.max(0, (Number(closeQty) || 0) + delta));
      setCloseQty(nextQty.toFixed(2));
    };

    return (
      <>
        <div className="fixed inset-0 z-[310] bg-black/70 backdrop-blur-[4px]" onClick={() => setClosingPosition(null)} />
        <div className="fixed inset-0 z-[311] flex items-center justify-center p-4 pointer-events-none">
          <div className="max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[8px] px-5 py-4 pointer-events-auto shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style={{ background: '#17181E' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[17px] font-extrabold" style={{ color: actionColor }}>{actionText}</span>
                  <span className="truncate font-mono text-[17px] font-extrabold text-white/94">{position.symbol}</span>
                </div>
                <div className="mt-4 grid grid-cols-6 gap-3 text-[10px] font-semibold">
                  <div><div className="text-white/52">入场价格</div><div className="mt-1 font-mono text-[12px] font-extrabold text-white/92">{position.avgEntryPrice.toFixed(dec)} USDT</div></div>
                  <div><div className="text-white/52">标记价格</div><FlashValue text={liveMark.toFixed(dec)} className="mt-1 inline-block font-mono text-[12px] font-extrabold text-white/92" /></div>
                  <div><div className="text-white/52">Delta</div><div className="mt-1 font-mono text-[12px] font-extrabold text-white/92">{(closingQuote?.delta ?? position.delta / sign).toFixed(4)}</div></div>
                  <div><div className="text-white/52">Gamma</div><div className="mt-1 font-mono text-[12px] font-extrabold text-white/92">{(closingQuote?.gamma ?? position.gamma / sign).toFixed(5)}</div></div>
                  <div><div className="text-white/52">Vega</div><div className="mt-1 font-mono text-[12px] font-extrabold text-white/92">{(closingQuote?.vega ?? position.vega / sign).toFixed(4)}</div></div>
                  <div><div className="text-white/52">Theta</div><div className="mt-1 font-mono text-[12px] font-extrabold text-white/92">{(closingQuote?.theta ?? position.theta / sign).toFixed(4)}</div></div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClosingPosition(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white/45 transition-colors hover:bg-[#3A3B40] hover:text-white/80"
                aria-label="关闭平仓面板"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-[minmax(0,0.95fr)_minmax(260px,1fr)] gap-6">
              <div>
                <div className="mb-4 grid grid-cols-[1fr_1fr] gap-4 text-[12px] font-extrabold">
                  <div className="text-white/52">最高/最低</div>
                  <div className="font-mono text-white/92">{highPx.toFixed(dec)}/{lowPx.toFixed(dec)}</div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-3 text-[10px] font-bold text-white/45">
                  <span>订单价格</span>
                  <span className="text-right">合约数量</span>
                  <span className="text-right">总计{coin}</span>
                </div>
                <div className="mt-3 space-y-1.5 font-mono text-[12px] font-extrabold">
                  {askRows.map((level, idx) => {
                    return (
                      <div key={`ask-${level.price}-${idx}`} className="grid grid-cols-[1fr_1fr_1fr] gap-x-3">
                        <FlashValue text={level.price.toFixed(dec)} style={{ color: 'var(--db-down)' }} />
                        <FlashValue text={level.size.toFixed(2)} className="text-right text-white/92" />
                        <FlashValue text={level.total.toFixed(2)} className="text-right text-white/92" />
                      </div>
                    );
                  })}
                </div>

                <div className="my-3 grid grid-cols-[1fr_1fr_1fr] gap-x-3 font-mono text-[13px] font-extrabold">
                  <FlashValue text={`↓ ${liveMark.toFixed(dec)}`} style={{ color: actionColor }} />
                  <div className="text-right text-[var(--db-accent)]">
                    <span className="mr-1">⚑</span>
                    <FlashValue text={liveMark.toFixed(dec)} />
                  </div>
                  <div className="self-end text-right text-[9px] font-bold text-white/52">IV: {currentIv > 0 ? currentIv.toFixed(2) : '—'}%</div>
                </div>

                <div className="space-y-1.5 font-mono text-[12px] font-extrabold">
                  {bidRows.map((level, idx) => (
                    <div key={`bid-${level.price}-${idx}`} className="grid grid-cols-[1fr_1fr_1fr] gap-x-3">
                      <FlashValue text={level.price.toFixed(dec)} style={{ color: 'var(--db-up)' }} />
                      <FlashValue text={level.size.toFixed(2)} className="text-right text-white/92" />
                      <FlashValue text={level.total.toFixed(2)} className="text-right text-white/92" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[15px] font-extrabold text-white/92">{orderTypeLabel}平仓</div>
                <div className="mt-3">
                  <div
                    className="flex h-8 w-full items-center justify-between rounded-[4px] px-3 text-[12px] font-extrabold text-white/90"
                    style={{ background: TILE_BG }}
                  >
                    <span>{orderTypeLabel}</span>
                    <ChevronDown size={14} className="text-white/45" />
                  </div>
                </div>

                {isLimitClose && (
                  <>
                    <label className="mt-3 block rounded-[4px] px-3 py-1.5" style={{ background: TILE_BG }}>
                      <div className="text-[10px] font-bold text-white/78">价格</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <input
                          value={closePrice}
                          onChange={e => setClosePrice(e.target.value)}
                          className="min-w-0 flex-1 bg-transparent font-mono text-[14px] font-extrabold text-white/94 outline-none"
                          inputMode="decimal"
                        />
                        <span className="text-[12px] font-extrabold text-white/88">USDT</span>
                      </div>
                    </label>
                    <label className="mt-1.5 block rounded-[4px] px-3 py-1.5 ring-1 ring-inset ring-white/[0.06]" style={{ background: '#1E2026' }}>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[12px] font-bold text-white/48">IV</span>
                        <input
                          value={currentIv > 0 ? currentIv.toFixed(2) : ''}
                          disabled
                          placeholder="—"
                          className="min-w-0 flex-1 bg-transparent text-right font-mono text-[14px] font-extrabold text-white/90 outline-none"
                        />
                        <span className="text-[12px] font-extrabold text-white/80">%</span>
                      </div>
                    </label>
                  </>
                )}

                <label className="mt-3 block rounded-[4px] px-3 py-1.5" style={{ background: TILE_BG }}>
                  <div className="text-[10px] font-bold text-white/78">数量 ({coin})</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <input
                      value={closeQty}
                      onChange={e => setCloseQty(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[14px] font-extrabold text-white/94 outline-none"
                      inputMode="decimal"
                    />
                    <button type="button" onClick={() => bumpCloseQty(-Math.max(position.qty * 0.05, 0.01))} className="text-[17px] leading-none text-white/55 transition-colors hover:text-white/85">−</button>
                    <span className="h-4 w-px bg-white/18" />
                    <button type="button" onClick={() => bumpCloseQty(Math.max(position.qty * 0.05, 0.01))} className="text-[19px] leading-none text-white/55 transition-colors hover:text-white/85">+</button>
                  </div>
                </label>

                <div className="relative mt-4">
                  <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[#2B2D35]" />
                  <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--db-accent)]" style={{ width: `${sliderValue}%` }} />
                  {[0, 20, 50, 75, 100].map(point => (
                    <button
                      key={point}
                      type="button"
                      onClick={() => onClosePercentChange(String(point))}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--db-accent)] bg-[#17181E]"
                      style={{ left: `${point}%` }}
                      aria-label={`平仓 ${point}%`}
                    />
                  ))}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={sliderValue}
                    onChange={e => onClosePercentChange(e.target.value)}
                    className="relative z-[1] block h-5 w-full cursor-pointer opacity-0"
                  />
                </div>
                <div className="flex justify-between font-mono text-[11px] font-bold text-white/55">
                  <span>0</span>
                  <span>{sliderValue.toFixed(0)}%</span>
                </div>

                <div className="mt-4 rounded-[4px] px-3 py-2 text-[11px] font-semibold leading-relaxed text-white/62" style={{ background: TILE_BG }}>
                  仓位将以 <span className="text-white/92">{isLimitClose ? `${px.toFixed(dec)}` : '市价'}</span> 平仓<span className="text-white/92">{qty.toFixed(2)}</span> 手，{pnlText}{' '}
                  <span style={{ color: pnl >= 0 ? 'var(--db-up)' : 'var(--db-down)' }}>{Math.abs(pnl).toFixed(3)} USDT</span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={confirmClosePosition}
                className="h-9 rounded-full text-[13px] font-extrabold text-black transition-opacity hover:opacity-90 active:translate-y-px"
                style={{ background: ORANGE }}
              >
                确认
              </button>
              <button
                type="button"
                onClick={() => setClosingPosition(null)}
                className="h-9 rounded-full text-[13px] font-extrabold text-white/86 ring-1 ring-inset ring-white/30 transition-colors hover:bg-[#3A3B40] active:translate-y-px"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </>
    );
  })();

  if (embedded) {
    return (
      <>
        <div className={cn('rounded-lg overflow-hidden shrink-0 flex flex-col', className)}
          style={{
            background: PANEL_BG,
            height: 320,
            ...style,
          }}>
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.05]">
            <div className="text-[12px] font-semibold text-white/78">模拟仓位</div>
            <span className="rounded px-1.5 py-[2px] text-[9px] font-bold text-[var(--db-accent)]" style={{ background: 'rgba(247,166,0,0.12)' }}>SIM</span>
            {tabBar}
            <div className="flex-1" />
            <button onClick={() => setCollapsed(c => !c)} className="flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-[#3A3B40] hover:text-white/80" title={collapsed ? '展开仓位面板' : '收起仓位面板'}>
              <ChevronsUpDown size={13} />
            </button>
          </div>
          <div className="border-b border-white/[0.04] px-3 py-2">{summary}</div>
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
            {collapsed ? (
              <div className="flex h-full items-center justify-center text-[12px] text-white/40">
                {hasData ? '已收起，点击右侧按钮展开明细' : '暂无模拟交易数据'}
              </div>
            ) : (
              table
            )}
          </div>
        </div>
        {editOrderModal}
        {closePositionModal}
      </>
    );
  }
  // Trade-modal version — fixed height, internal vertical scroll.
  return (
    <>
      <div className={cn('flex flex-col shrink-0 min-h-0', className)} style={{ borderTop: BORDER, backgroundColor: PANEL_BG, ...style }}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-white/[0.05]">
          <div className="text-[12px] font-semibold text-white/78">模拟仓位</div>
          {tabBar}
        </div>
        <div className="border-b border-white/[0.04] px-3 py-2">{summary}</div>
        <div className="flex-1 min-h-0 overflow-auto">{table}</div>
      </div>
      {editOrderModal}
      {closePositionModal}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FlashValue — briefly highlights (green up / red down) when its value changes,
// so live WS ticks are visible at a glance.
// ─────────────────────────────────────────────────────────────────────────────

const FlashValue = memo(({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) => {
  const prev = useRef(text);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (text === prev.current) return;
    const a = parseFloat(text.replace(/[^0-9.-]/g, ''));
    const b = parseFloat(prev.current.replace(/[^0-9.-]/g, ''));
    prev.current = text;
    setFlash(Number.isFinite(a) && Number.isFinite(b) ? (a > b ? 'up' : a < b ? 'down' : null) : null);
    const t = setTimeout(() => setFlash(null), 480);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <span className={className} style={{
      ...style,
      borderRadius: 3,
      transition: 'background-color 90ms ease',
      backgroundColor: flash === 'up' ? 'rgba(40,200,64,0.30)' : flash === 'down' ? 'rgba(255,95,87,0.30)' : 'transparent',
      boxShadow: flash ? '0 0 0 2px ' + (flash === 'up' ? 'rgba(40,200,64,0.30)' : 'rgba(255,95,87,0.30)') : 'none',
    }}>{text}</span>
  );
});
FlashValue.displayName = 'FlashValue';

// ─────────────────────────────────────────────────────────────────────────────
// Trading panel (ticket + order book + greeks + positions)
// ─────────────────────────────────────────────────────────────────────────────

// 下单前 sanity 灯：总灯三档（绿可下 / 黄注意 / 红别急）。
const SANITY: Record<CheckLevel, { color: string; text: string }> = {
  ok:    { color: '#22C55E', text: '数据新鲜 · 可下单' },
  warn:  { color: '#F59E0B', text: '可下单，但先看一眼' },
  block: { color: '#EF4444', text: '先改一下再下单' },
};

function ExecutionModeControls({
  executionMode,
  liveReady,
  source,
  onModeChange,
}: {
  executionMode: ExecutionMode;
  liveReady: { armed: boolean; credentials: boolean; venueSupported: boolean };
  source: DataSource;
  onModeChange: (mode: ExecutionMode) => void;
}) {
  const venueLabel = source === 'bybit' ? 'Bybit' : 'Deribit';
  const statusText = executionMode === 'sim'
    ? '模拟账本'
    : !liveReady.venueSupported
      ? '通道未接入'
      : !liveReady.credentials
        ? '缺少密钥'
        : `${venueLabel} 实盘`;

  return (
    <div className="hidden h-[50px] w-[132px] flex-col justify-center rounded-[6px] px-2 py-1.5 lg:flex" style={{ background: TILE_BG }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold text-white/40">执行</span>
        <span className="truncate text-[10px] font-semibold text-white/35">{statusText}</span>
      </div>
      <div className="flex items-center gap-1">
        {(['sim', 'live'] as const).map(mode => {
          const active = executionMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              aria-pressed={active}
              className="h-6 flex-1 rounded-[6px] text-[10px] font-extrabold transition-colors active:translate-y-px"
              style={{
                background: active ? (mode === 'sim' ? SELECTED_BG : 'rgba(239,68,68,0.18)') : 'transparent',
                color: active ? (mode === 'sim' ? ORANGE : '#EF4444') : 'rgba(255,255,255,0.55)',
              }}
            >
              {mode === 'sim' ? '模拟' : '实盘'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const TradingPanel = memo(({ selected, coin, source, spot, dateLabel, dec, daysToExp, book, executionAdapter, onClose, chainFeedKey, marketQuotes }: {
  selected: SelectedCell; coin: Coin; source: DataSource; spot: number; dateLabel: string; dec: number; daysToExp: number;
  book: GlobalOptionBook; executionAdapter?: ExecutionAdapter; onClose: () => void; chainFeedKey: string;
  marketQuotes?: Map<string, PositionMarketQuote>;
}) => {
  const { row, side } = selected;
  const opt = side === 'call' ? row.call : row.put;
  const contractName = `${coin}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;
  const symbol = optionSymbol(coin, dateLabel, row.strike, side === 'call' ? 'C' : 'P');

  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop'>('limit');
  const [quoteMode, setQuoteMode] = useState<'price' | 'iv'>('price');
  const [price, setPrice] = useState((opt.ask ?? opt.mark).toFixed(dec));
  const [iv, setIv] = useState(opt.iv.toFixed(1));
  const [qty, setQty] = useState('1');
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const [tif, setTif] = useState<TimeInForce>('GTC');
  const [tifOpen, setTifOpen] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [postOnly, setPostOnly] = useState(false);
  const [rtab, setRtab] = useState<'book' | 'trades' | 'greeks'>('book');
  const [executionMode, setExecutionModeState] = useState<ExecutionMode>(initialExecutionMode);

  const setExecutionMode = useCallback((mode: ExecutionMode) => {
    setExecutionModeState(mode);
    storageSet(EXEC_MODE_KEY, mode);
  }, []);

  const deribitCredentials = useMemo(() => getDeribitCredentials(), []);
  const liveReady = useMemo(() => ({
    armed: executionMode === 'live' ? LIVE_ARMED : false,
    credentials: source === 'deribit' ? !!deribitCredentials : true,
    venueSupported: source === 'deribit' || source === 'bybit',
  }), [deribitCredentials, executionMode, source]);
  const adapter = useMemo<ExecutionAdapter>(() => {
    if (executionAdapter) return executionAdapter;
    if (executionMode === 'sim') return createSimExecutionAdapter(book);
    if (source === 'bybit') return createBybitLiveAdapter({
      armed: LIVE_ARMED,
      testnet: LIVE_TESTNET,
    });
    return createDeribitLiveAdapter({
      armed: LIVE_ARMED,
      testnet: LIVE_TESTNET,
      credentials: deribitCredentials,
    });
  }, [book, deribitCredentials, executionAdapter, executionMode, source]);
  const currentPosition = useMemo(() => book.positions.find(p => p.symbol === symbol), [book.positions, symbol]);
  const currentSignedQty = currentPosition ? (currentPosition.side === 'long' ? currentPosition.qty : -currentPosition.qty) : 0;

  // ── 真实订单簿深度（只订当前合约，关面板即退订）──────────────────────────────
  const rawDepth = useOptionDepth(source, opt.instrument);
  // 原生→USD 系数：用顶档锚点反推（反向币本位 ×spot、USDC/Bybit ≈ ×1），免依赖 underlying_price
  const usdBook = useMemo<DepthBook | null>(() => {
    if (!rawDepth || (rawDepth.bids.length === 0 && rawDepth.asks.length === 0)) return null;
    const rawAsk = rawDepth.asks[0]?.price, rawBid = rawDepth.bids[0]?.price;
    let factor = 1;
    if (opt.ask != null && rawAsk) factor = opt.ask / rawAsk;
    else if (opt.bid != null && rawBid) factor = opt.bid / rawBid;
    const conv = (l: DepthLevel) => ({ price: l.price * factor, size: l.size });
    return { bids: rawDepth.bids.map(conv), asks: rawDepth.asks.map(conv) };
  }, [rawDepth, opt.ask, opt.bid]);

  // 显示阶梯（带累计 total，各取前 8 档）
  const T = daysToExp / 365;
  const ladder = useMemo(() => {
    const strike = row.strike;
    const isCall = side === 'call';
    const mk = (levels: DepthLevel[]) => {
      let cum = 0;
      return levels.slice(0, 8).map(l => {
        cum += l.size;
        return { price: l.price, size: l.size, total: cum, iv: bsIV(spot, strike, T, l.price, isCall) };
      });
    };
    return { asks: mk(usdBook?.asks ?? []), bids: mk(usdBook?.bids ?? []) };
  }, [usdBook, spot, row.strike, side, T]);
  const maxAskTotal = ladder.asks[ladder.asks.length - 1]?.total ?? 1;
  const maxBidTotal = ladder.bids[ladder.bids.length - 1]?.total ?? 1;

  const nPrice = useMemo(() => { const p = parseFloat((price || '').replace(/,/g, '')); return Number.isFinite(p) ? p : 0; }, [price]);
  const nQty = useMemo(() => { const q = parseFloat((qty || '').replace(/,/g, '')); return Number.isFinite(q) ? q : 0; }, [qty]);

  // 市价吃单预估（当前数量）：买扫卖档、卖扫买档；取两侧较差的滑点喂给 sanity
  const slip = useMemo(() => {
    if (!usdBook || !(nQty > 0)) return null;
    const b = fillAgainstBook(usdBook, 'buy', nQty), s = fillAgainstBook(usdBook, 'sell', nQty);
    return { buy: b, sell: s, worstPct: Math.max(b.slippagePct, s.slippagePct) };
  }, [usdBook, nQty]);
  const orderPrice = orderType === 'market' ? opt.mark : nPrice;
  const notional = orderPrice * nQty;
  const deltaNotional = Math.abs(opt.delta * spot * nQty);
  const fee = notional * 0.0005;
  const margin = notional * 0.12;
  const totalCost = notional + fee;

  // ── 下单前 sanity 灯：报价新鲜度 + 现价新鲜度 + 点差 + 限价偏离 + 数量 ──
  const chainFr = useFreshness(chainFeedKey);
  const spotFr = useFreshness('ws-deribit');
  const sanity = useMemo(() => runRiskGate({
    mode: adapter.mode,
    bid: opt.bid, ask: opt.ask, mark: opt.mark,
    qty: nQty, price: nPrice, orderType,
    chainKind: chainFr?.kind ?? null, chainAgeMs: chainFr?.ageMs ?? null,
    spotKind: spotFr?.kind ?? null,
    marketSlippagePct: orderType === 'market' ? (slip?.worstPct ?? null) : null,
    notional,
    deltaNotional,
    liveReady,
  }), [adapter.mode, opt.bid, opt.ask, opt.mark, nQty, nPrice, orderType, chainFr?.kind, chainFr?.ageMs, spotFr?.kind, slip?.worstPct, notional, deltaNotional, liveReady]);

  const submit = useCallback(async (s: 'buy' | 'sell') => {
    if (sanity.blocking) {
      soundOrderError();
      return;
    }
    const intent: TradeIntent = {
      mode: adapter.mode,
      venue: source,
      accountId: adapter.mode === 'sim' ? 'sim-options' : `${source}-mainnet`,
      source: 'options-chain',
      side: s,
      orderType,
      symbol,
      qty: nQty,
      price: orderPrice,
      mark: opt.mark,
      reduceOnly,
      postOnly,
      tif,
      greeks: { delta: opt.delta, gamma: opt.gamma, theta: opt.theta, vega: opt.vega },
      instrument: opt.instrument,
      book: usdBook ?? undefined,
    };
    const result = await adapter.placeOrder(intent);
    if (result.status === 'rejected') soundOrderError();
    else if (adapter.mode === 'live') {
      requestAccountPositionsRefresh({
        reason: 'live-order-submitted',
        venue: source,
        orderId: result.orderId,
      });
    }
  }, [adapter, sanity.blocking, source, orderType, symbol, nQty, orderPrice, opt.mark, opt.delta, opt.gamma, opt.theta, opt.vega, opt.instrument, reduceOnly, postOnly, tif, usdBook]);

  const light = SANITY[sanity.level];
  const issues = sanity.checks.filter(c => c.level !== 'ok');
  const sideTone = side === 'call'
    ? { bg: 'rgba(36,174,100,0.14)', color: 'var(--db-up)', label: 'CALL' }
    : { bg: 'rgba(239,69,74,0.14)', color: 'var(--db-down)', label: 'PUT' };
  const execTone = adapter.mode === 'sim'
    ? { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' }
    : { bg: 'rgba(239,68,68,0.16)', color: '#EF4444' };
  const headerMetrics = [
    { label: '标记', value: opt.mark.toFixed(dec), color: 'rgba(255,255,255,0.86)' },
    { label: 'IV', value: `${opt.iv.toFixed(1)}%`, color: 'var(--db-warn)' },
    { label: 'Spot', value: spot.toLocaleString('en-US', { maximumFractionDigits: 2 }), color: 'rgba(255,255,255,0.70)' },
    { label: 'Δ', value: opt.delta.toFixed(3), color: opt.delta >= 0 ? 'var(--db-up)' : 'var(--db-down)' },
    { label: 'Θ', value: opt.theta.toFixed(4), color: 'var(--db-down)' },
  ];

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ backgroundColor: '#000000' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ borderBottom: `1px solid ${SUBTLE_LINE}`, backgroundColor: NAV_BG }}>
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[15px] font-extrabold leading-none text-white/92">{contractName}</div>
            <span className="shrink-0 rounded-[4px] px-2 py-1 text-[10px] font-extrabold leading-none"
              style={{ background: sideTone.bg, color: sideTone.color }}>{sideTone.label}</span>
            <span className="shrink-0 rounded-[4px] px-2 py-1 text-[10px] font-extrabold leading-none"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.58)' }}>{dateLabel}</span>
            <span
              className="shrink-0 rounded-[4px] px-2 py-1 text-[10px] font-extrabold leading-none"
              title={adapter.mode === 'sim' ? '本面板为模拟交易，不会真实下单' : '实盘适配器接管下单前请确认风控开关'}
              style={{ background: execTone.bg, color: execTone.color }}
            >
              {adapter.label}
            </span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
            {headerMetrics.map(item => (
              <div key={item.label} className="flex h-5 items-center gap-1 rounded-[4px] px-1.5" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className="text-[10px] font-semibold text-white/35">{item.label}</span>
                <FlashValue text={item.value} className="font-mono text-[11px] font-bold" style={{ color: item.color }} />
              </div>
            ))}
            <FreshnessTag dataKey="ws-deribit" label="现价" />
            <FreshnessTag dataKey={chainFeedKey} label="报价" />
          </div>
        </div>
        <div className="flex-1" />
        <ExecutionModeControls
          executionMode={executionMode}
          liveReady={liveReady}
          source={source}
          onModeChange={setExecutionMode}
        />
        <button type="button" onClick={onClose} aria-label="关闭下单面板" className="w-8 h-8 rounded-[6px] flex items-center justify-center transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: TILE_BG, color: 'rgba(255,255,255,0.55)' }}>
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT: ticket */}
        <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 320, borderRight: `1px solid ${SUBTLE_LINE}`, backgroundColor: PANEL_BG }}>
          <div className="px-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <button className="h-9 w-full rounded-[4px] px-3 flex items-center justify-between transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: TILE_BG }}
                  onClick={() => setOrderTypeOpen(v => !v)}>
                  <span className="text-[12px] font-extrabold text-white/85">
                    {orderType === 'limit' ? '限价单' : orderType === 'market' ? '市价单' : '止损单'}{quoteMode === 'iv' ? '/IV' : ''}
                  </span>
                  <ChevronDown size={16} className="text-white/45" />
                </button>
                <Popover open={orderTypeOpen} onClose={() => setOrderTypeOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-full z-[320]">
                  {([
                    { key: 'limit' as const, label: '限价单' },
                    { key: 'market' as const, label: '市价单' },
                  ]).map(item => {
                    const active = orderType === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 text-[12px] rounded-[4px] transition-colors hover:bg-[rgba(255,255,255,0.08)]"
                        style={{ color: active ? ORANGE : 'rgba(255,255,255,0.68)' }}
                        onClick={() => {
                          setOrderType(item.key);
                          setOrderTypeOpen(false);
                        }}
                      >
                        <span className="font-extrabold">{item.label}</span>
                        {active ? <Check size={14} color={ORANGE} strokeWidth={3} /> : <span className="w-[14px]" />}
                      </button>
                    );
                  })}
                </Popover>
              </div>
              <button className="h-9 px-3 rounded-[4px] flex items-center gap-2 text-[12px] font-extrabold text-white/85 transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: TILE_BG }} title="RFQ">
                <span className="w-4 h-4 rounded-[4px] flex items-center justify-center text-[10px]" style={{ background: SELECTED_BG, color: 'rgba(255,255,255,0.70)' }}>◇</span>RFQ
              </button>
            </div>
          </div>

          <div className="px-3 pt-2 overflow-auto">
            <div className="text-[11px] font-semibold text-white/55 mb-1">合约（1 = 1 {coin}）<span className="float-right text-white/45 font-mono font-bold">≈ 0.01 {coin}</span></div>
            <div className="flex items-center rounded-[4px]" style={{ backgroundColor: TILE_BG }}>
              <input value={qty} onChange={e => setQty(e.target.value)} className="flex-1 bg-transparent px-3 py-1.5 text-[15px] font-extrabold outline-none" style={{ ...TABNUM, color: '#EAECEF' }} />
              <div className="px-2 flex flex-col">
                <button type="button" aria-label="增加数量" className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => (parseFloat(v || '0') + 0.01).toFixed(2))}>▲</button>
                <button type="button" aria-label="减少数量" className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => Math.max(0.01, parseFloat(v || '0') - 0.01).toFixed(2))}>▼</button>
              </div>
              <div className="px-3 text-[12px] font-bold text-white/60" style={{ borderLeft: `1px solid ${SUBTLE_LINE}` }}>合约</div>
            </div>
            <div className="mt-1 text-[11px] font-semibold text-white/55">可用: <span className="text-white/85 font-mono font-bold">≈ 16,849,985.46 USDC</span></div>

            {/* ── Quick quantity presets ── */}
            <div className="mt-1 flex items-center gap-1">
              {[0.1, 0.5, 1, 5, 10].map(n => {
                const active = Math.abs(Number(qty || 0) - n) < 0.005;
                return (
                  <button key={n} onClick={() => setQty(n.toFixed(2))}
                    className={cn('h-5 px-2 rounded-[4px] text-[10px] font-bold transition-colors active:translate-y-px',
                      active
                        ? 'text-[var(--db-accent)]'
                        : 'text-white/45 hover:text-white/85 hover:bg-[#3A3B40]')}
                    style={{ background: active ? SELECTED_BG : TILE_BG }}
                  >{n}</button>
                );
              })}
              <div className="flex-1" />
              <span className="text-[10px] text-white/25 font-mono">合约</span>
            </div>

            <div className="mt-2 flex flex-col gap-1.5">
              <button onClick={() => setQuoteMode('price')} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full flex items-center justify-center" style={{ border: `1px solid ${quoteMode === 'price' ? ORANGE : 'rgba(255,255,255,0.20)'}` }}>
                  {quoteMode === 'price' ? <span className="w-2 h-2 rounded-full" style={{ background: ORANGE }} /> : null}
                </span>
                <span className="text-[12px] font-extrabold text-white/85">限价单</span>
                <div className="ml-auto flex items-center rounded-[4px] overflow-hidden" style={{ backgroundColor: TILE_BG, width: 200 }}>
                  <input disabled={quoteMode !== 'price' || orderType === 'market'} value={price} onChange={e => setPrice(e.target.value)} className="flex-1 bg-transparent px-3 py-1.5 text-[15px] font-extrabold outline-none disabled:opacity-40" style={{ ...TABNUM, color: '#EAECEF' }} />
                  <span className="px-3 text-[12px] font-bold text-white/45">USDC</span>
                </div>
              </button>
              <button onClick={() => setQuoteMode('iv')} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full flex items-center justify-center" style={{ border: `1px solid ${quoteMode === 'iv' ? ORANGE : 'rgba(255,255,255,0.20)'}` }}>
                  {quoteMode === 'iv' ? <span className="w-2 h-2 rounded-full" style={{ background: ORANGE }} /> : null}
                </span>
                <span className="text-[12px] font-extrabold text-white/85">隐含波动率</span>
                <span className="text-[10px] font-extrabold px-1.5 py-[2px] rounded-[4px]" style={{ background: 'rgba(247,166,0,0.12)', color: ORANGE }}>高级</span>
                <div className="ml-auto flex items-center rounded-[4px] overflow-hidden" style={{ backgroundColor: TILE_BG, width: 200 }}>
                  <input disabled={quoteMode !== 'iv'} value={iv} onChange={e => setIv(e.target.value)} className="flex-1 bg-transparent px-3 py-1.5 text-[15px] font-extrabold outline-none disabled:opacity-40" style={{ ...TABNUM, color: '#EAECEF' }} />
                  <span className="px-3 text-[12px] font-bold text-white/45">IV (%)</span>
                </div>
              </button>
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.45)' }}>挂单方式</span>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{reduceOnly ? 'Reduce-only' : ''}{reduceOnly && postOnly ? ' · ' : ''}{postOnly ? 'Post-only' : ''}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button onClick={() => setReduceOnly(v => !v)} className="h-7 px-3 rounded-[4px] text-[11px] font-semibold transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: reduceOnly ? SELECTED_BG : TILE_BG, color: reduceOnly ? ORANGE : 'rgba(255,255,255,0.60)' }}>减少</button>
                <button onClick={() => setPostOnly(v => !v)} className="h-7 px-3 rounded-[4px] text-[11px] font-semibold transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: postOnly ? SELECTED_BG : TILE_BG, color: postOnly ? ORANGE : 'rgba(255,255,255,0.60)' }}>挂单</button>
                <div className="relative">
                  <button onClick={() => setTifOpen(o => !o)} className="h-7 px-3 rounded-[4px] text-[11px] font-semibold flex items-center gap-2 transition-colors hover:bg-[#3A3B40] active:translate-y-px" style={{ background: tifOpen ? SELECTED_BG : TILE_BG, color: tifOpen ? ORANGE : 'rgba(255,255,255,0.75)' }}>{tif} <ChevronDown size={14} className="text-white/45" /></button>
                  <Popover open={tifOpen} onClose={() => setTifOpen(false)} panelClassName="db-menu-panel absolute left-0 top-full mt-2 w-[140px]">
                    {(['GTC', 'IOC', 'FOK'] as const).map(k => (
                      <button key={k} className="w-full flex items-center justify-between px-3 py-2 text-[12px] rounded-[4px] hover:bg-[rgba(255,255,255,0.08)] transition-colors" style={{ color: k === tif ? ORANGE : 'rgba(255,255,255,0.62)' }} onClick={() => { setTif(k); setTifOpen(false); }}>
                        <span className="font-semibold">{k}</span>{k === tif ? <Check size={14} color={ORANGE} strokeWidth={3} /> : <span className="opacity-0">.</span>}
                      </button>
                    ))}
                  </Popover>
                </div>
              </div>
            </div>

            <div className="mt-2 inline-flex items-center gap-2">
              <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-[4px]" style={{ background: 'rgba(247,166,0,0.12)', color: ORANGE }}>仓位 {currentSignedQty >= 0 ? '+' : ''}{currentSignedQty.toFixed(2)}</span>
            </div>

            {/* ── 下单前 sanity 灯 —— 护栏的终点：护到你手指按下去那刻 ── */}
            <div className="mt-2 rounded-[4px] px-2.5 py-1.5" style={{ background: `${light.color}14` }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: light.color }} />
                <span className="text-[11px] font-extrabold" style={{ color: light.color }}>{light.text}</span>
                {issues.length > 0 && <span className="ml-auto text-[11px] font-bold" style={{ color: light.color }}>{issues.length} 项</span>}
              </div>
              {issues.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {issues.map(c => (
                    <div key={c.id} className="flex items-start gap-1.5 text-[10px] leading-tight">
                      <span className="mt-[3px] h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: c.level === 'block' ? '#EF4444' : '#F59E0B' }} />
                      <span className="text-white/45 font-semibold shrink-0">{c.label}</span>
                      <span className="text-white/70">{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-2 flex gap-2">
              <button onClick={() => submit('buy')} disabled={sanity.blocking} className="flex-1 h-10 rounded-[4px] text-[13px] font-extrabold text-black hover:opacity-90 active:translate-y-px transition-all disabled:opacity-40 disabled:pointer-events-none" style={{ background: 'var(--db-up)' }}>买入</button>
              <button onClick={() => submit('sell')} disabled={sanity.blocking} className="flex-1 h-10 rounded-[4px] text-[13px] font-extrabold text-black hover:opacity-90 active:translate-y-px transition-all disabled:opacity-40 disabled:pointer-events-none" style={{ background: 'var(--db-down)' }}>卖出</button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-4 text-[11px]">
              <div><div className="text-white/45 font-semibold">购买保证金</div><div className="mt-1 text-white font-mono font-extrabold">{totalCost.toFixed(2)} USDC</div></div>
              <div className="text-right"><div className="text-white/45 font-semibold">卖出保证金</div><div className="mt-1 text-white font-mono font-extrabold">{(margin * 1.8).toFixed(2)} USDC</div></div>
            </div>

            <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${SUBTLE_LINE}` }}>
              <div className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[11px]">
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
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ background: PANEL_BG }}>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center shrink-0 px-1" style={{ borderBottom: `1px solid ${SUBTLE_LINE}`, background: PANEL_BG }}>
              {([{ key: 'book', label: '订单薄' }, { key: 'trades', label: '近期交易' }, { key: 'greeks', label: 'Greeks' }] as const).map(t => (
                <button key={t.key} onClick={() => setRtab(t.key)} className="px-3 py-2 text-[12px] font-semibold shrink-0 transition-colors hover:text-white/85 active:translate-y-px" style={{ color: rtab === t.key ? ORANGE : 'rgba(255,255,255,0.50)', borderBottom: rtab === t.key ? `2px solid ${ORANGE}` : '2px solid transparent' }}>{t.label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {rtab === 'book' && (
                <div>
                  {ladder.asks.length === 0 && ladder.bids.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[200px] gap-1.5 text-[13px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      {source === 'bybit'
                        ? <span>Bybit 真实盘口待接入（下一步用 REST 轮询）</span>
                        : <span>等待真实盘口…</span>}
                      <span className="text-[11px] text-white/25">只显示真实深度，不再编示意盘口</span>
                    </div>
                  ) : (
                    <>
                      <div className="px-2 py-1 flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        <span className="font-semibold" style={{ color: 'var(--db-up)' }}>实时盘口</span>
                        <FreshnessTag dataKey={opt.instrument ? depthFeedKey(opt.instrument) : ''} />
                        {slip && (
                          <span className="ml-auto" style={{ ...TABNUM }}>
                            {nQty} 张市价滑点 ≈ 买 <b style={{ color: 'var(--db-down)' }}>{slip.buy.slippagePct.toFixed(1)}%</b> / 卖 <b style={{ color: 'var(--db-up)' }}>{slip.sell.slippagePct.toFixed(1)}%</b>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-[2fr_1.5fr_3fr_2fr_2fr_3fr_1.5fr_2fr] px-2 py-1 text-[11px]" style={{ borderBottom: `1px solid ${SUBTLE_LINE}`, background: TABLE_HEAD_BG, color: 'rgba(255,255,255,0.45)' }}>
                        <span className="text-right">总计</span><span className="text-right">数量</span>
                        <span className="text-right pr-1">IV</span><span className="text-right pr-2">买价</span>
                        <span className="text-left pl-2">卖价</span><span className="text-left pl-1">IV</span>
                        <span className="text-left">数量</span><span className="text-left">总计</span>
                      </div>
                      {Array.from({ length: Math.max(ladder.asks.length, ladder.bids.length) }, (_, i) => {
                        const a = ladder.asks[i], b = ladder.bids[i];
                        return (
                          <div key={i} className="relative grid grid-cols-[2fr_1.5fr_3fr_2fr_2fr_3fr_1.5fr_2fr] px-2" style={{ height: 28 }}>
                            {b && <div className="absolute left-0 top-0 h-full pointer-events-none" style={{ width: `${(b.total / maxBidTotal) * 48}%`, background: 'rgba(40,200,64,0.08)' }} />}
                            {a && <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: `${(a.total / maxAskTotal) * 48}%`, background: 'rgba(255,95,87,0.08)' }} />}
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: 'rgba(255,255,255,0.45)' }}>{b ? b.total.toFixed(2) : '—'}</span>
                            <span
                              className="justify-self-end text-[11px] text-right self-center relative z-10 rounded-[4px] px-1.5 py-0.5 transition-colors hover:bg-[rgba(36,174,100,0.08)]"
                              style={{ ...TABNUM, color: '#EAECEF', cursor: b ? 'pointer' : 'default' }}
                              onClick={() => b && setQty(b.size.toFixed(0))}
                            >{b ? b.size.toFixed(2) : '—'}</span>
                            <span
                              className="justify-self-end text-[11px] text-right self-center relative z-10 rounded-[4px] px-1.5 py-0.5 font-mono transition-colors hover:bg-[rgba(36,174,100,0.08)]"
                              style={{ color: b?.iv != null ? '#EAECEF' : 'transparent', cursor: b ? 'pointer' : 'default' }}
                              onClick={() => b && setIv(b.iv.toFixed(1))}
                            >{b?.iv != null ? `${b.iv.toFixed(1)}%` : '—'}</span>
                            <span
                              className="relative z-10 self-center justify-self-end rounded-[4px] px-2 py-0.5 text-right text-[12px] font-medium transition-colors hover:bg-[rgba(36,174,100,0.12)]"
                              style={{ ...TABNUM, color: 'var(--db-up)', cursor: b ? 'pointer' : 'default' }}
                              onClick={() => b && setPrice(b.price.toFixed(dec))}
                            >
                              {b ? b.price.toFixed(dec) : '—'}
                            </span>
                            <span
                              className="relative z-10 self-center justify-self-start rounded-[4px] px-2 py-0.5 text-left text-[12px] font-medium transition-colors hover:bg-[rgba(239,69,74,0.12)]"
                              style={{ ...TABNUM, color: 'var(--db-down)', cursor: a ? 'pointer' : 'default' }}
                              onClick={() => a && setPrice(a.price.toFixed(dec))}
                            >
                              {a ? a.price.toFixed(dec) : '—'}
                            </span>
                            <span
                              className="justify-self-start text-[11px] text-left self-center relative z-10 rounded-[4px] px-1.5 py-0.5 font-mono transition-colors hover:bg-[rgba(239,69,74,0.08)]"
                              style={{ color: a?.iv != null ? '#EAECEF' : 'transparent', cursor: a ? 'pointer' : 'default' }}
                              onClick={() => a && setIv(a.iv.toFixed(1))}
                            >{a?.iv != null ? `${a.iv.toFixed(1)}%` : '—'}</span>
                            <span
                              className="justify-self-start text-[11px] text-left self-center relative z-10 rounded-[4px] px-1.5 py-0.5 transition-colors hover:bg-[rgba(239,69,74,0.08)]"
                              style={{ ...TABNUM, color: '#EAECEF', cursor: a ? 'pointer' : 'default' }}
                              onClick={() => a && setQty(a.size.toFixed(0))}
                            >{a ? a.size.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-left self-center relative z-10" style={{ ...TABNUM, color: 'rgba(255,255,255,0.45)' }}>{a ? a.total.toFixed(2) : '—'}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
              {rtab === 'greeks' && (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[
                    { label: 'Delta Δ', value: opt.delta.toFixed(4), color: 'var(--db-up)' },
                    { label: 'Gamma Γ', value: fmtGamma5(opt.gamma), color: 'var(--db-accent)' },
                    { label: 'Vega ν', value: opt.vega.toFixed(4), color: 'var(--db-warn)' },
                    { label: 'Theta Θ', value: opt.theta.toFixed(4), color: 'var(--db-down)' },
                    { label: 'IV', value: opt.iv.toFixed(2) + '%', color: 'var(--db-warn)' },
                    { label: 'Mark', value: opt.mark.toFixed(dec), color: '#EAECEF' },
                  ].map(g => (
                    <div key={g.label} className="rounded-[6px] p-3 transition-colors hover:bg-[#3A3B40]" style={{ backgroundColor: TILE_BG }}>
                      <div className="text-[10px] mb-1" style={{ color: 'rgba(255,255,255,0.45)' }}>{g.label}</div>
                      <div className="text-[14px] font-bold" style={{ ...TABNUM, color: g.color }}>{g.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {rtab === 'trades' && <div className="flex items-center justify-center h-32 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>近期无成交数据</div>}
            </div>
          </div>

          {/* BOTTOM: position / orders / history / trades */}
          <PositionsPanel book={book} style={{ maxHeight: 220 }} marketQuotes={marketQuotes} />
        </div>
      </div>
    </div>
  );
});
TradingPanel.displayName = 'TradingPanel';
