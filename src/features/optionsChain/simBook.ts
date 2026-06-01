// ═══════════════════════════════════════════════════════════════════════════════
// Local order book / positions — a self-contained simulated trading engine.
//
// Demo state lives per-mount (no global store / persistence): market orders fill at
// mark, limit orders rest until marketable, and `updateMarks` both auto-fills resting
// orders and marks open positions to market. Pure reducer + thin hook → easy to test.
// ═══════════════════════════════════════════════════════════════════════════════

import { useReducer, useCallback } from 'react';

export interface SimOrder { id: string; symbol: string; side: 'buy' | 'sell'; type: string; qty: number; price: number; optDelta: number; status: 'pending' | 'filled' | 'cancelled'; createdAt: number; filledPrice?: number }
export interface SimPosition { id: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; markPrice: number; unrealizedPnL: number; delta: number }
export interface SimFill { id: string; symbol: string; side: 'buy' | 'sell'; qty: number; price: number; fee: number; timestamp: number }

export interface PlaceArgs { side: 'buy' | 'sell'; type: 'limit' | 'market' | 'stop'; symbol: string; qty: number; price: number; mark: number; delta: number }

export interface BookState { positions: SimPosition[]; openOrders: SimOrder[]; orderHistory: SimOrder[]; fills: SimFill[] }

const rid = () => Math.random().toString(36).slice(2, 9);

/** Apply a fill to the positions list — proper average price + realized close. */
export function applyFill(ps: SimPosition[], symbol: string, side: 'buy' | 'sell', qty: number, px: number, optDelta: number): SimPosition[] {
  const signed = side === 'buy' ? qty : -qty;
  const ex = ps.find(p => p.symbol === symbol);
  if (!ex) {
    const sign = signed > 0 ? 1 : -1;
    return [...ps, { id: rid(), symbol, side: sign > 0 ? 'long' : 'short', qty: Math.abs(signed), avgEntryPrice: px, markPrice: px, unrealizedPnL: 0, delta: optDelta * sign }];
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
    ? { ...p, side: sign > 0 ? 'long' : 'short', qty: Math.abs(next), avgEntryPrice: avg, markPrice: px, unrealizedPnL: (px - avg) * Math.abs(next) * sign, delta: optDelta * sign }
    : p);
}

export type BookAction =
  | { t: 'place'; a: PlaceArgs }
  | { t: 'cancel'; id: string }
  | { t: 'marks'; marks: Record<string, number> };

export function bookReducer(s: BookState, action: BookAction): BookState {
  switch (action.t) {
    case 'place': {
      const a = action.a;
      const id = rid();
      const now = Date.now();
      if (a.type === 'market') {
        return {
          ...s,
          positions: applyFill(s.positions, a.symbol, a.side, a.qty, a.mark, a.delta),
          fills: [...s.fills, { id, symbol: a.symbol, side: a.side, qty: a.qty, price: a.mark, fee: a.mark * a.qty * 0.0005, timestamp: now }],
          orderHistory: [...s.orderHistory, { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.mark, optDelta: a.delta, status: 'filled', createdAt: now, filledPrice: a.mark }],
        };
      }
      const order: SimOrder = { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.price, optDelta: a.delta, status: 'pending', createdAt: now };
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
      for (const o of filled) positions = applyFill(positions, o.symbol, o.side, o.qty, o.price, o.optDelta);
      // Mark-to-market the open positions.
      positions = positions.map(p => {
        const m = marks[p.symbol];
        if (m == null) return p;
        const sign = p.side === 'long' ? 1 : -1;
        return { ...p, markPrice: m, unrealizedPnL: (m - p.avgEntryPrice) * p.qty * sign };
      });
      if (filled.length === 0 && positions === s.positions) return s;
      const now = Date.now();
      return {
        positions,
        openOrders: stillOpen,
        fills: filled.length ? [...s.fills, ...filled.map(o => ({ id: o.id, symbol: o.symbol, side: o.side, qty: o.qty, price: o.price, fee: o.price * o.qty * 0.0005, timestamp: now }))] : s.fills,
        orderHistory: filled.length ? s.orderHistory.map(e => filled.find(o => o.id === e.id) ? { ...e, status: 'filled' as const, filledPrice: e.price } : e) : s.orderHistory,
      };
    }
    default:
      return s;
  }
}

export function useLocalBook() {
  const [state, dispatch] = useReducer(bookReducer, { positions: [], openOrders: [], orderHistory: [], fills: [] });
  const placeOrder = useCallback((a: PlaceArgs) => dispatch({ t: 'place', a }), []);
  const cancelOrder = useCallback((id: string) => dispatch({ t: 'cancel', id }), []);
  const updateMarks = useCallback((marks: Record<string, number>) => dispatch({ t: 'marks', marks }), []);
  return { ...state, placeOrder, cancelOrder, updateMarks };
}
