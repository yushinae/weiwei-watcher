// ═══════════════════════════════════════════════════════════════════════════════
// Local order book / positions — a self-contained simulated trading engine.
//
// Demo state lives per-mount (no global store / persistence): market orders fill at
// mark, limit orders rest until marketable, and `updateMarks` both auto-fills resting
// orders and marks open positions to market. Pure reducer + thin hook → easy to test.
// ═══════════════════════════════════════════════════════════════════════════════

import { useReducer, useCallback } from 'react';

export interface SimOrder { id: string; symbol: string; side: 'buy' | 'sell'; type: string; qty: number; price: number; optDelta: number; optGamma?: number; optTheta?: number; optVega?: number; status: 'pending' | 'filled' | 'cancelled'; createdAt: number; filledPrice?: number }
export interface SimPosition { id: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; markPrice: number; unrealizedPnL: number; delta: number; gamma: number; theta: number; vega: number }
export interface SimFill { id: string; symbol: string; side: 'buy' | 'sell'; qty: number; price: number; fee: number; timestamp: number }

// ── 真实盘口（喂给撮合，让市价单吃单滑点、限价单按真盘口成交） ──────────────────
export interface DepthLevel { price: number; size: number }
/** bids 价降序、asks 价升序（best 在最前）。 */
export interface DepthBook { bids: DepthLevel[]; asks: DepthLevel[] }

export interface FillResult {
  filledQty: number;    // 实际从真实档位吃到的量
  avgPrice: number;     // 成交均价（VWAP），无成交为 0
  bestPrice: number;    // 对手方最优价（算滑点的基准）
  worstPrice: number;   // 吃到的最差档位价
  slippagePct: number;  // (均价 − 最优)/最优 ×100，正=对吃单方更差
  restQty: number;      // 未成交剩余
}

/**
 * 把 qty 打到真实盘口上：买单扫 asks（升序）、卖单扫 bids（降序）。
 * 传 limitPrice 则只吃不超过限价的档位（限价单）；不传则一路吃（市价单）。
 */
export function fillAgainstBook(book: DepthBook, side: 'buy' | 'sell', qty: number, limitPrice?: number): FillResult {
  const levels = side === 'buy' ? book.asks : book.bids;
  const best = levels[0]?.price ?? 0;
  let remaining = qty, cost = 0, filled = 0, worst = best;
  for (const lv of levels) {
    if (remaining <= 1e-12) break;
    if (limitPrice != null) {
      if (side === 'buy' && lv.price > limitPrice + 1e-12) break;
      if (side === 'sell' && lv.price < limitPrice - 1e-12) break;
    }
    const take = Math.min(remaining, lv.size);
    if (take <= 0) continue;
    cost += take * lv.price;
    filled += take;
    worst = lv.price;
    remaining -= take;
  }
  const avgPrice = filled > 0 ? cost / filled : 0;
  const slippagePct = best > 0 && filled > 0
    ? ((side === 'buy' ? avgPrice - best : best - avgPrice) / best) * 100
    : 0;
  return { filledQty: filled, avgPrice, bestPrice: best, worstPrice: worst, slippagePct, restQty: remaining };
}

export interface PlaceArgs { side: 'buy' | 'sell'; type: 'limit' | 'market' | 'stop'; symbol: string; qty: number; price: number; mark: number; delta: number; gamma?: number; theta?: number; vega?: number; book?: DepthBook }

export interface BookState { positions: SimPosition[]; openOrders: SimOrder[]; orderHistory: SimOrder[]; fills: SimFill[] }

const rid = () => Math.random().toString(36).slice(2, 9);
const FEE_RATE = 0.0005;
const hasDepth = (b?: DepthBook): b is DepthBook => !!b && (b.bids.length + b.asks.length) > 0;
const mkFill = (id: string, a: PlaceArgs, qty: number, px: number, now: number): SimFill =>
  ({ id, symbol: a.symbol, side: a.side, qty, price: px, fee: px * qty * FEE_RATE, timestamp: now });
const mkHist = (id: string, a: PlaceArgs, qty: number, px: number, now: number): SimOrder =>
  ({ id, symbol: a.symbol, side: a.side, type: a.type, qty, price: px, optDelta: a.delta, status: 'filled', createdAt: now, filledPrice: px });

/** 期权希腊字母（不含 delta 方向特殊性，gamma/theta/vega 按 long/short 取符号）。 */
export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

/** Apply a fill to the positions list — proper average price + realized close. */
export function applyFill(ps: SimPosition[], symbol: string, side: 'buy' | 'sell', qty: number, px: number, greeks: Greeks): SimPosition[] {
  const { delta: optDelta, gamma: g = 0, theta: t = 0, vega: v = 0 } = greeks;
  const signed = side === 'buy' ? qty : -qty;
  const ex = ps.find(p => p.symbol === symbol);
  if (!ex) {
    const sign = signed > 0 ? 1 : -1;
    return [...ps, { id: rid(), symbol, side: sign > 0 ? 'long' : 'short', qty: Math.abs(signed), avgEntryPrice: px, markPrice: px, unrealizedPnL: 0, delta: optDelta * sign, gamma: g * sign, theta: t * sign, vega: v * sign }];
  }
  const cur = ex.side === 'long' ? ex.qty : -ex.qty;
  const next = cur + signed;
  if (Math.abs(next) < 1e-9) return ps.filter(p => p.symbol !== symbol);
  const growing = Math.sign(next) === Math.sign(cur) && Math.abs(next) > Math.abs(cur);
  const flipped = Math.sign(next) !== Math.sign(cur);
  let avg = ex.avgEntryPrice;
  if (cur === 0 || growing) avg = (ex.avgEntryPrice * Math.abs(cur) + px * Math.abs(signed)) / Math.abs(next);
  else if (flipped) avg = px; // remaining qty opens fresh at fill price
  const sign = next > 0 ? 1 : -1;
  return ps.map(p => p.symbol === symbol
    ? { ...p, side: sign > 0 ? 'long' : 'short', qty: Math.abs(next), avgEntryPrice: avg, markPrice: px, unrealizedPnL: (px - avg) * Math.abs(next) * sign, delta: optDelta * sign, gamma: g * sign, theta: t * sign, vega: v * sign }
    : p);
}

export type BookAction =
  | { t: 'place'; a: PlaceArgs }
  | { t: 'cancel'; id: string }
  | { t: 'marks'; marks: Record<string, number> }
  | { t: 'clear' };

export function bookReducer(s: BookState, action: BookAction): BookState {
  switch (action.t) {
    case 'place': {
      const a = action.a;
      const now = Date.now();

      // ── 市价单：吃真实盘口（加权成交价 + 滑点）；无盘口时退回 mark ──
      if (a.type === 'market') {
        let px = a.mark;
        if (hasDepth(a.book)) {
          const r = fillAgainstBook(a.book, a.side, a.qty);
          if (r.filledQty > 0) {
            // 盘口吃不满（深度太薄）时，剩余按最差档位估价，sim 仍全量成交但价反映真实冲击
            px = r.restQty > 1e-9
              ? (r.avgPrice * r.filledQty + r.worstPrice * r.restQty) / a.qty
              : r.avgPrice;
          }
        }
        const id = rid();
        return {
          ...s,
          positions: applyFill(s.positions, a.symbol, a.side, a.qty, px, { delta: a.delta, gamma: a.gamma ?? 0, theta: a.theta ?? 0, vega: a.vega ?? 0 }),
          fills: [...s.fills, mkFill(id, a, a.qty, px, now)],
          orderHistory: [...s.orderHistory, mkHist(id, a, a.qty, px, now)],
        };
      }

      // ── 限价单：可成交部分按真盘口立刻吃掉，剩余挂单（其后由 marks 穿越成交） ──
      if (a.type === 'limit' && hasDepth(a.book)) {
        const r = fillAgainstBook(a.book, a.side, a.qty, a.price);
        if (r.filledQty > 1e-9) {
          const fid = rid();
          const positions = applyFill(s.positions, a.symbol, a.side, r.filledQty, r.avgPrice, { delta: a.delta, gamma: a.gamma ?? 0, theta: a.theta ?? 0, vega: a.vega ?? 0 });
          const fills = [...s.fills, mkFill(fid, a, r.filledQty, r.avgPrice, now)];
          const orderHistory = [...s.orderHistory, mkHist(fid, a, r.filledQty, r.avgPrice, now)];
          if (r.restQty > 1e-9) {
            const order: SimOrder = { id: rid(), symbol: a.symbol, side: a.side, type: a.type, qty: r.restQty, price: a.price, optDelta: a.delta, optGamma: a.gamma, optTheta: a.theta, optVega: a.vega, status: 'pending', createdAt: now };
            return { positions, openOrders: [...s.openOrders, order], orderHistory: [...orderHistory, order], fills };
          }
          return { ...s, positions, fills, orderHistory };
        }
      }

      // ── 不可立即成交（或无盘口）：整单挂出 ──
      const id = rid();
      const order: SimOrder = { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.price, optDelta: a.delta, optGamma: a.gamma, optTheta: a.theta, optVega: a.vega, status: 'pending', createdAt: now };
      return { ...s, openOrders: [...s.openOrders, order], orderHistory: [...s.orderHistory, order] };
    }
    case 'cancel': {
      return {
        ...s,
        openOrders: s.openOrders.filter(o => o.id !== action.id),
        orderHistory: s.orderHistory.map(o => o.id === action.id ? { ...o, status: 'cancelled' } : o),
      };
    }
    case 'marks': {
      const { marks } = action;
      // Fill any marketable resting orders (buy: mark ≤ limit, sell: mark ≥ limit).
      const stillOpen: SimOrder[] = [];
      const filled: SimOrder[] = [];
      for (const o of s.openOrders) {
        const m = marks[o.symbol];
        if (m != null && ((o.side === 'buy' && m <= o.price) || (o.side === 'sell' && m >= o.price))) filled.push(o);
        else stillOpen.push(o);
      }
      let positions = s.positions;
      for (const o of filled) positions = applyFill(positions, o.symbol, o.side, o.qty, o.price, { delta: o.optDelta, gamma: o.optGamma ?? 0, theta: o.optTheta ?? 0, vega: o.optVega ?? 0 });
      // Mark-to-market the open positions — only allocate a new object when the
      // mark actually moved, so an unchanged tick keeps reference equality and
      // doesn't trigger a redundant store write / re-render.
      let positionsChanged = positions !== s.positions;
      const remarked = positions.map(p => {
        const m = marks[p.symbol];
        if (m == null || m === p.markPrice) return p;
        positionsChanged = true;
        const sign = p.side === 'long' ? 1 : -1;
        return { ...p, markPrice: m, unrealizedPnL: (m - p.avgEntryPrice) * p.qty * sign };
      });
      positions = positionsChanged ? remarked : s.positions;
      if (filled.length === 0 && !positionsChanged) return s;
      const now = Date.now();
      return {
        positions,
        openOrders: stillOpen,
        fills: filled.length ? [...s.fills, ...filled.map(o => ({ id: o.id, symbol: o.symbol, side: o.side, qty: o.qty, price: o.price, fee: o.price * o.qty * 0.0005, timestamp: now }))] : s.fills,
        orderHistory: filled.length ? s.orderHistory.map(e => filled.find(o => o.id === e.id) ? { ...e, status: 'filled' as const, filledPrice: e.price } : e) : s.orderHistory,
      };
    }
    case 'clear':
      return { positions: [], openOrders: [], orderHistory: [], fills: [] };
    default:
      return s;
  }
}

export function useLocalBook() {
  const [state, dispatch] = useReducer(bookReducer, { positions: [], openOrders: [], orderHistory: [], fills: [] });
  const placeOrder = useCallback((a: PlaceArgs) => dispatch({ t: 'place', a }), []);
  const cancelOrder = useCallback((id: string) => dispatch({ t: 'cancel', id }), []);
  const updateMarks = useCallback((marks: Record<string, number>) => dispatch({ t: 'marks', marks }), []);
  const clearBook = useCallback(() => dispatch({ t: 'clear' }), []);
  return { ...state, placeOrder, cancelOrder, updateMarks, clearBook };
}
