// ═══════════════════════════════════════════════════════════════════════════════
// Trading panel — the click-through trade ticket, order book, greeks, and the
// shared positions / orders / history table.
//
//   FrameControls  — 放大 / 拉伸 / 关闭 window chrome (placeholders for the widget shell)
//   PositionsPanel — 仓位 / 未结订单 / 订单历史 / 交易历史 (page card + modal footer)
//   FlashValue     — green-up / red-down flash so live WS ticks are visible
//   TradingPanel   — the full trade modal body
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect, useRef, memo } from 'react';
import { ChevronDown, X, Check, Maximize2, Minimize2, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Coin, DataSource } from './chainModel';
import { useLocalBook, fillAgainstBook, type DepthBook, type DepthLevel } from './simBook';
import { useOptionDepth, depthFeedKey } from './optionDepth';
import { Popover } from './chainCells';
import type { SelectedCell } from './chainCells';
import {
  BG_MAIN, BG_HEADER, BG_CARD, BORDER_C, CARD_SHADOW, TABNUM, fmtGamma5, optionSymbol,
} from './chainConstants';
import FreshnessTag from '../../components/FreshnessTag';
import { useFreshness } from '../../registry/data/freshness';
import { preTradeChecks, type CheckLevel } from './preTradeChecks';

// ─────────────────────────────────────────────────────────────────────────────
// Positions panel — 仓位 / 未结订单 / 订单历史 / 交易历史 (shared: page + trade modal)
// ─────────────────────────────────────────────────────────────────────────────

const BORDER = `1px solid ${BORDER_C}`;
const POS_GRID = 'grid grid-cols-[minmax(150px,1.6fr)_90px_110px_110px_110px_110px_90px]';
const POS_MIN_W = 780;

// Window-frame controls (最大化 / 收起) — top-right of a component card.
// Only the buttons whose handlers are supplied are rendered (no dead placeholders).
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

export function PositionsPanel({ book, style, className, embedded }: {
  book: ReturnType<typeof useLocalBook>; style?: React.CSSProperties; className?: string; embedded?: boolean;
}) {
  const [btab, setBtab] = useState<'position' | 'open' | 'history' | 'trades'>('position');
  const [collapsed, setCollapsed] = useState(false);
  const { positions, openOrders, orderHistory, fills, cancelOrder } = book;

  // Themed segmented tab buttons.
  const tabBar = (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg w-max" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--db-border)' }}>
      {([
        { k: 'position' as const, l: '仓位', c: positions.length },
        { k: 'open' as const, l: '未结订单', c: openOrders.length },
        { k: 'history' as const, l: '订单历史记录', c: orderHistory.length },
        { k: 'trades' as const, l: '交易历史记录', c: fills.length },
      ]).map(t => {
        const on = btab === t.k;
        return (
          <button key={t.k} onClick={() => setBtab(t.k)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold transition-colors whitespace-nowrap"
            style={{ background: on ? 'var(--color-surface-5, #2E2E2E)' : 'transparent', color: on ? '#EAECEF' : 'rgba(255,255,255,0.55)' }}>
            {t.l}<span className="text-[11px]" style={{ color: on ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)' }}>{t.c}</span>
          </button>
        );
      })}
    </div>
  );

  const table = (
    <div style={{ minWidth: POS_MIN_W }}>
      <div className={cn(POS_GRID, 'px-3 py-2 text-[11px] border-b sticky top-0')} style={{ borderColor: BORDER_C, color: 'rgba(255,255,255,0.35)', backgroundColor: BG_HEADER }}>
        <div>产品</div><div className="text-right">数量</div><div className="text-right">值</div><div className="text-right">平均价格</div><div className="text-right">标记价格</div><div className="text-right">损益</div><div className="text-right">Δ</div>
      </div>
      {btab === 'position' && positions.length === 0 && <div className="h-[110px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无持仓</div>}
      {btab === 'position' && positions.map(p => (
        <div key={p.id} className={cn(POS_GRID, 'px-3 py-2 text-[12px] border-b')} style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="font-mono font-bold truncate" style={{ color: p.side === 'long' ? 'var(--db-up)' : 'var(--db-down)' }}>{p.symbol}</div>
          <div className="text-right font-mono">{p.qty.toFixed(2)}</div>
          <div className="text-right font-mono">{(p.markPrice * p.qty).toFixed(2)}</div>
          <div className="text-right font-mono">{p.avgEntryPrice.toFixed(2)}</div>
          <div className="text-right font-mono">{p.markPrice.toFixed(2)}</div>
          <div className="text-right font-mono font-bold" style={{ color: p.unrealizedPnL >= 0 ? 'var(--db-up)' : 'var(--db-down)' }}>{p.unrealizedPnL >= 0 ? '+' : ''}{p.unrealizedPnL.toFixed(2)}</div>
          <div className="text-right font-mono">{p.delta.toFixed(3)}</div>
        </div>
      ))}
      {btab === 'open' && openOrders.length === 0 && <div className="h-[110px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无未结订单</div>}
      {btab === 'open' && openOrders.map(o => (
        <div key={o.id} className={cn(POS_GRID, 'px-3 py-2 text-[12px] border-b')} style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="font-mono font-bold truncate">{o.symbol}</div><div className="text-right font-mono">{o.qty.toFixed(2)}</div><div className="text-right font-mono">{o.type === 'limit' ? '限价' : o.type === 'stop' ? '止损' : '市价'}</div>
          <div className="text-right font-mono">{o.price.toFixed(2)}</div><div className="text-right font-mono">—</div>
          <div className="text-right font-mono" style={{ color: o.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{o.side === 'buy' ? '买入' : '卖出'}</div>
          <div className="text-right">
            <button onClick={() => cancelOrder(o.id)} className="text-[11px] font-semibold px-1.5 py-0.5 rounded hover:bg-white/[0.08]" style={{ color: 'var(--db-down)' }}>取消</button>
          </div>
        </div>
      ))}
      {btab === 'history' && orderHistory.length === 0 && <div className="h-[110px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无历史订单</div>}
      {btab === 'history' && orderHistory.slice(-30).reverse().map(o => (
        <div key={o.id} className={cn(POS_GRID, 'px-3 py-2 text-[12px] border-b')} style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="font-mono font-bold truncate">{o.symbol}</div><div className="text-right font-mono">{o.qty.toFixed(2)}</div><div className="text-right font-mono">—</div>
          <div className="text-right font-mono">{(o.filledPrice ?? o.price).toFixed(2)}</div><div className="text-right font-mono">—</div>
          <div className="text-right font-mono" style={{ color: o.status === 'filled' ? 'var(--db-up)' : o.status === 'cancelled' ? '#888888' : 'var(--db-warn)' }}>{o.status === 'filled' ? '已成交' : o.status === 'cancelled' ? '已取消' : '待成交'}</div>
          <div className="text-right font-mono">{new Date(o.createdAt).toLocaleTimeString()}</div>
        </div>
      ))}
      {btab === 'trades' && fills.length === 0 && <div className="h-[110px] flex items-center justify-center text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>暂无成交记录</div>}
      {btab === 'trades' && fills.slice(-30).reverse().map(f => (
        <div key={f.id} className={cn(POS_GRID, 'px-3 py-2 text-[12px] border-b')} style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="font-mono font-bold truncate">{f.symbol}</div><div className="text-right font-mono">{f.qty.toFixed(2)}</div><div className="text-right font-mono">{(f.price * f.qty).toFixed(2)}</div>
          <div className="text-right font-mono">{f.price.toFixed(2)}</div><div className="text-right font-mono">{f.fee.toFixed(4)}</div>
          <div className="text-right font-mono" style={{ color: f.side === 'buy' ? 'var(--db-up)' : 'var(--db-down)' }}>{f.side === 'buy' ? '买入' : '卖出'}</div>
          <div className="text-right font-mono">{new Date(f.timestamp).toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  );

  if (embedded) {
    // Page card — own horizontal scroll, grows vertically (page scrolls).
    return (
      <div className={cn('rounded-xl border overflow-hidden shrink-0', className)} style={{ borderColor: BORDER_C, backgroundColor: BG_CARD, boxShadow: CARD_SHADOW, ...style }}>
        <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: BORDER_C }}>
          {tabBar}
          <span className="text-[10px] font-extrabold px-2 py-[2px] rounded-full border" title="模拟持仓 / 订单，刷新后清空"
            style={{ borderColor: 'rgba(254,188,46,0.40)', background: 'rgba(254,188,46,0.12)', color: 'var(--db-warn)' }}>模拟</span>
          <div className="flex-1" />
          <FrameControls collapsed={collapsed} onToggleCollapse={() => setCollapsed(c => !c)} />
        </div>
        {!collapsed && <div className="overflow-x-auto">{table}</div>}
      </div>
    );
  }
  // Trade-modal version — fixed height, internal vertical scroll.
  return (
    <div className={cn('border-t flex flex-col shrink-0 min-h-0', className)} style={{ borderTop: BORDER, backgroundColor: BG_HEADER, ...style }}>
      <div className="px-3 py-2 shrink-0">{tabBar}</div>
      <div className="flex-1 min-h-0 overflow-auto">{table}</div>
    </div>
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

export const TradingPanel = memo(({ selected, coin, source, spot, dateLabel, dec, book, onClose, chainFeedKey }: {
  selected: SelectedCell; coin: Coin; source: DataSource; spot: number; dateLabel: string; dec: number;
  book: ReturnType<typeof useLocalBook>; onClose: () => void; chainFeedKey: string;
}) => {
  const { row, side } = selected;
  const opt = side === 'call' ? row.call : row.put;
  const contractName = `${coin}-${row.strike}-${side === 'call' ? 'C' : 'P'}`;
  const symbol = optionSymbol(coin, dateLabel, row.strike, side === 'call' ? 'C' : 'P');

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

  const { placeOrder } = book;

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
  const ladder = useMemo(() => {
    const mk = (levels: DepthLevel[]) => { let cum = 0; return levels.slice(0, 8).map(l => { cum += l.size; return { price: l.price, size: l.size, total: cum }; }); };
    return { asks: mk(usdBook?.asks ?? []), bids: mk(usdBook?.bids ?? []) };
  }, [usdBook]);
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
  const notional = nPrice * nQty;
  const fee = notional * 0.0005;
  const margin = notional * 0.12;
  const totalCost = notional + fee;

  // ── 下单前 sanity 灯：报价新鲜度 + 现价新鲜度 + 点差 + 限价偏离 + 数量 ──
  const chainFr = useFreshness(chainFeedKey);
  const spotFr = useFreshness('ws-deribit');
  const sanity = useMemo(() => preTradeChecks({
    bid: opt.bid, ask: opt.ask, mark: opt.mark,
    qty: nQty, price: nPrice, orderType,
    chainKind: chainFr?.kind ?? null, chainAgeMs: chainFr?.ageMs ?? null,
    spotKind: spotFr?.kind ?? null,
    marketSlippagePct: orderType === 'market' ? (slip?.worstPct ?? null) : null,
  }), [opt.bid, opt.ask, opt.mark, nQty, nPrice, orderType, chainFr?.kind, chainFr?.ageMs, spotFr?.kind, slip?.worstPct]);

  const submit = (s: 'buy' | 'sell') => {
    if (sanity.blocking) return;
    placeOrder({
      side: s, type: orderType, symbol, qty: nQty,
      price: orderType === 'market' ? opt.mark : nPrice, mark: opt.mark, delta: opt.delta,
      book: usdBook ?? undefined,
    });
  };

  const light = SANITY[sanity.level];
  const issues = sanity.checks.filter(c => c.level !== 'ok');

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
            <span className="text-[10px] font-extrabold px-2 py-[2px] rounded-full shrink-0 border"
              title="本面板为模拟交易，不会真实下单"
              style={{ borderColor: 'rgba(254,188,46,0.40)', background: 'rgba(254,188,46,0.12)', color: 'var(--db-warn)' }}>模拟</span>
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
                <FlashValue text={item.value} className="font-mono font-bold" style={{ color: item.color }} />
              </div>
            ))}
            <span className="text-white/10">·</span>
            <FreshnessTag dataKey="ws-deribit" label="现价" />
            <FreshnessTag dataKey={chainFeedKey} label="报价" />
          </div>
        </div>
        <div className="flex-1" />
        <button type="button" onClick={onClose} aria-label="关闭下单面板" className="w-8 h-8 rounded-[10px] border flex items-center justify-center hover:bg-white/[0.06] transition-colors" style={{ borderColor: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.55)' }}>
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
                <button type="button" aria-label="增加数量" className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => (parseFloat(v || '0') + 0.01).toFixed(2))}>▲</button>
                <button type="button" aria-label="减少数量" className="text-white/55 hover:text-white text-[10px]" onClick={() => setQty(v => Math.max(0.01, parseFloat(v || '0') - 0.01).toFixed(2))}>▼</button>
              </div>
              <div className="px-3 text-[12px] font-bold text-white/60 border-l" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>合约</div>
            </div>
            <div className="mt-2 text-[12px] font-semibold text-white/55">可用: <span className="text-white/85 font-mono font-bold">≈ 16,849,985.46 USDC</span></div>

            {/* ── Quick quantity presets ── */}
            <div className="mt-1.5 flex items-center gap-1">
              {[0.1, 0.5, 1, 5, 10].map(n => {
                const active = Math.abs(Number(qty || 0) - n) < 0.005;
                return (
                  <button key={n} onClick={() => setQty(n.toFixed(2))}
                    className={cn('h-6 px-2.5 rounded-[6px] text-[11px] font-bold transition-colors',
                      active
                        ? 'text-white/90'
                        : 'text-white/40 hover:text-white/65')}
                    style={{ background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: active ? '1px solid rgba(255,255,255,0.18)' : '1px solid transparent' }}
                  >{n}</button>
                );
              })}
              <div className="flex-1" />
              <span className="text-[10px] text-white/25 font-mono">合约</span>
            </div>

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

            {/* ── 下单前 sanity 灯 —— 护栏的终点：护到你手指按下去那刻 ── */}
            <div className="mt-3 rounded-[10px] border px-3 py-2" style={{ borderColor: `${light.color}55`, background: `${light.color}14` }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: light.color }} />
                <span className="text-[12px] font-extrabold" style={{ color: light.color }}>{light.text}</span>
                {issues.length > 0 && <span className="ml-auto text-[11px] font-bold" style={{ color: light.color }}>{issues.length} 项</span>}
              </div>
              {issues.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {issues.map(c => (
                    <div key={c.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
                      <span className="mt-[3px] h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: c.level === 'block' ? '#EF4444' : '#F59E0B' }} />
                      <span className="text-white/45 font-semibold shrink-0">{c.label}</span>
                      <span className="text-white/70">{c.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={() => submit('buy')} disabled={sanity.blocking} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none" style={{ background: 'var(--db-up)' }}>买入</button>
              <button onClick={() => submit('sell')} disabled={sanity.blocking} className="flex-1 h-[44px] rounded-[12px] text-[14px] font-extrabold text-black hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none" style={{ background: 'var(--db-down)' }}>卖出</button>
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
                  {ladder.asks.length === 0 && ladder.bids.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[200px] gap-1.5 text-[13px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      {source === 'bybit'
                        ? <span>Bybit 真实盘口待接入（下一步用 REST 轮询）</span>
                        : <span>等待真实盘口…</span>}
                      <span className="text-[11px] text-white/25">只显示真实深度，不再编示意盘口</span>
                    </div>
                  ) : (
                    <>
                      <div className="px-2 py-1 flex items-center gap-2 text-[10px]" style={{ color: '#888888' }}>
                        <span className="font-semibold" style={{ color: 'var(--db-up)' }}>实时盘口</span>
                        <FreshnessTag dataKey={opt.instrument ? depthFeedKey(opt.instrument) : ''} />
                        {slip && (
                          <span className="ml-auto" style={{ ...TABNUM }}>
                            {nQty} 张市价滑点 ≈ 买 <b style={{ color: 'var(--db-down)' }}>{slip.buy.slippagePct.toFixed(1)}%</b> / 卖 <b style={{ color: 'var(--db-up)' }}>{slip.sell.slippagePct.toFixed(1)}%</b>
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-[2fr_1.5fr_3fr_3fr_1.5fr_2fr] px-2 py-1 border-b text-[11px]" style={{ borderBottom: BORDER, color: '#888888' }}>
                        <span className="text-right">总计</span><span className="text-right">数量</span>
                        <span className="text-right pr-3">买价</span><span className="text-left pl-3">卖价</span>
                        <span className="text-right">数量</span><span className="text-right">总计</span>
                      </div>
                      {Array.from({ length: Math.max(ladder.asks.length, ladder.bids.length) }, (_, i) => {
                        const a = ladder.asks[i], b = ladder.bids[i];
                        return (
                          <div key={i} className="relative grid grid-cols-[2fr_1.5fr_3fr_3fr_1.5fr_2fr] px-2 hover:bg-white/[0.03]" style={{ height: 26 }}>
                            {a && <div className="absolute left-0 top-0 h-full pointer-events-none" style={{ width: `${(a.total / maxAskTotal) * 48}%`, background: 'rgba(255,95,87,0.08)' }} />}
                            {b && <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: `${(b.total / maxBidTotal) * 48}%`, background: 'rgba(40,200,64,0.08)' }} />}
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#888888' }}>{a ? a.total.toFixed(2) : '—'}</span>
                            <span className="text-[11px] text-right self-center relative z-10" style={{ ...TABNUM, color: '#EAECEF' }}>{a ? a.size.toFixed(2) : '—'}</span>
                            <span className="text-[12px] font-medium text-right self-center pr-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: 'var(--db-down)' }} onClick={() => a && setPrice(a.price.toFixed(dec))}>{a ? a.price.toFixed(dec) : '—'}</span>
                            <span className="text-[12px] font-medium text-left self-center pl-3 relative z-10 cursor-pointer" style={{ ...TABNUM, color: 'var(--db-up)' }} onClick={() => b && setPrice(b.price.toFixed(dec))}>{b ? b.price.toFixed(dec) : '—'}</span>
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
          <PositionsPanel book={book} style={{ maxHeight: 220 }} />
        </div>
      </div>
    </div>
  );
});
TradingPanel.displayName = 'TradingPanel';
