// ═══════════════════════════════════════════════════════════════════════════════
// Local order book / positions — a self-contained simulated trading engine.
//
// 持久化 + 全局：状态存 localStorage(weiwei.simbook.v1)、模块级单例 + subscribe，
// 跨页跨刷新都在（期权页下单 → 账户页「模拟」页签也能看到）。市价单按 mark 成交、
// 限价单挂到可成交、updateMarks 既撮合挂单又把持仓盯市。纯 reducer + 薄 hook → 易测。
// ═══════════════════════════════════════════════════════════════════════════════

import { useSyncExternalStore, useCallback } from 'react';

// optDelta/optGamma/optVega/optTheta：成交时从期权链快照的"每张"希腊（自然符号，call δ>0/put δ<0；θ<0）
export interface SimOrder { id: string; symbol: string; side: 'buy' | 'sell'; type: string; qty: number; price: number; optDelta: number; optGamma?: number; optVega?: number; optTheta?: number; status: 'pending' | 'filled' | 'cancelled'; createdAt: number; filledPrice?: number }
// delta/gamma/vega/theta：仓位级"每张×方向符号"（long +/short −），组合风险用它 ×qty 折美元希腊
export interface SimPosition { id: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; markPrice: number; unrealizedPnL: number; delta: number; gamma?: number; vega?: number; theta?: number }
export interface SimFill { id: string; symbol: string; side: 'buy' | 'sell'; qty: number; price: number; fee: number; timestamp: number }

export interface PlaceArgs { side: 'buy' | 'sell'; type: 'limit' | 'market' | 'stop'; symbol: string; qty: number; price: number; mark: number; delta: number; gamma?: number; vega?: number; theta?: number }

export interface BookState { positions: SimPosition[]; openOrders: SimOrder[]; orderHistory: SimOrder[]; fills: SimFill[] }

const rid = () => Math.random().toString(36).slice(2, 9);

/** Apply a fill to the positions list — proper average price + realized close. */
export function applyFill(ps: SimPosition[], symbol: string, side: 'buy' | 'sell', qty: number, px: number, optDelta: number, g?: { gamma?: number; vega?: number; theta?: number }): SimPosition[] {
  const signed = side === 'buy' ? qty : -qty;
  const og = g?.gamma ?? 0, ov = g?.vega ?? 0, ot = g?.theta ?? 0;
  const ex = ps.find(p => p.symbol === symbol);
  if (!ex) {
    const sign = signed > 0 ? 1 : -1;
    return [...ps, { id: rid(), symbol, side: sign > 0 ? 'long' : 'short', qty: Math.abs(signed), avgEntryPrice: px, markPrice: px, unrealizedPnL: 0, delta: optDelta * sign, gamma: og * sign, vega: ov * sign, theta: ot * sign }];
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
  // 希腊用本次成交的每张快照 × 新方向符号（每张希腊随行情变，沙盒取最近一次即可）
  return ps.map(p => p.symbol === symbol
    ? { ...p, side: sign > 0 ? 'long' : 'short', qty: Math.abs(next), avgEntryPrice: avg, markPrice: px, unrealizedPnL: (px - avg) * Math.abs(next) * sign, delta: optDelta * sign, gamma: og * sign, vega: ov * sign, theta: ot * sign }
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
          positions: applyFill(s.positions, a.symbol, a.side, a.qty, a.mark, a.delta, a),
          fills: [...s.fills, { id, symbol: a.symbol, side: a.side, qty: a.qty, price: a.mark, fee: a.mark * a.qty * 0.0005, timestamp: now }],
          orderHistory: [...s.orderHistory, { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.mark, optDelta: a.delta, optGamma: a.gamma, optVega: a.vega, optTheta: a.theta, status: 'filled', createdAt: now, filledPrice: a.mark }],
        };
      }
      const order: SimOrder = { id, symbol: a.symbol, side: a.side, type: a.type, qty: a.qty, price: a.price, optDelta: a.delta, optGamma: a.gamma, optVega: a.vega, optTheta: a.theta, status: 'pending', createdAt: now };
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
      for (const o of filled) positions = applyFill(positions, o.symbol, o.side, o.qty, o.price, o.optDelta, { gamma: o.optGamma, vega: o.optVega, theta: o.optTheta });
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

// ── 持久化全局单例 ───────────────────────────────────────────────────────────
const SIM_KEY = 'weiwei.simbook.v1';
const emptyBook = (): BookState => ({ positions: [], openOrders: [], orderHistory: [], fills: [] });

function loadBook(): BookState {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (raw) return { ...emptyBook(), ...(JSON.parse(raw) as Partial<BookState>) };
  } catch { /* ignore */ }
  return emptyBook();
}

let simState: BookState = loadBook();
const simListeners = new Set<() => void>();

function commitSim(next: BookState) {
  if (next === simState) return;
  simState = next;
  try { localStorage.setItem(SIM_KEY, JSON.stringify(next)); } catch { /* quota — ignore */ }
  simListeners.forEach(l => l());
}

export function dispatchSim(action: BookAction): void { commitSim(bookReducer(simState, action)); }
export function subscribeSim(cb: () => void): () => void { simListeners.add(cb); return () => { simListeners.delete(cb); }; }
export function getSimState(): BookState { return simState; }
export function clearSimBook(): void { commitSim(emptyBook()); }

/** 读取持久化模拟簿（全局单例）；接口与原 per-mount 版一致，期权页无需改动。 */
export function useLocalBook() {
  const state = useSyncExternalStore(subscribeSim, getSimState, getSimState);
  const placeOrder = useCallback((a: PlaceArgs) => dispatchSim({ t: 'place', a }), []);
  const cancelOrder = useCallback((id: string) => dispatchSim({ t: 'cancel', id }), []);
  const updateMarks = useCallback((marks: Record<string, number>) => dispatchSim({ t: 'marks', marks }), []);
  return { ...state, placeOrder, cancelOrder, updateMarks };
}
