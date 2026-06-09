import { useCallback, useSyncExternalStore } from 'react';
import { bookReducer, type BookState, type PlaceArgs, type SimPosition } from './simBook';
import { get as apiGet, put as apiPut } from '../../api';
import { soundOrderCancelled, soundOrderFilled, soundOrderPlaced } from './orderSounds';

const STORAGE_KEY = 'sim-option-book';

const initialState: BookState = {
  positions: [],
  openOrders: [],
  orderHistory: [],
  fills: [],
};

// 启动时从后端恢复（优先），后端失败时从 localStorage 恢复
async function loadState(): Promise<BookState> {
  try {
    // 优先后端（防关机丢失）
    const data = await apiGet<BookState>('/api/sim-options');
    if (data && Array.isArray(data.positions) && Array.isArray(data.openOrders)) {
      return data;
    }
  } catch {
    // 后端失败，从 localStorage 读
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as BookState;
    if (!Array.isArray(parsed.positions) || !Array.isArray(parsed.openOrders)) return initialState;
    return parsed;
  } catch {
    return initialState;
  }
}

// 每次 dispatch 后保存：localStorage（快）+ 后端（持久）
function saveState(s: BookState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('[optionBookStore] localStorage.setItem failed:', e);
  }
  apiPut('/api/sim-options', s).catch((e) => {
    console.warn('[optionBookStore] backend sync failed:', e);
  });
}

let state: BookState = initialState;
// 异步初始化：启动时从后端/localStorage 恢复
loadState().then(loaded => {
  if (loaded !== initialState) {
    state = loaded;
    emit();
  }
});

const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

function playBookTransitionSound(prev: BookState, next: BookState) {
  if (next.fills.length > prev.fills.length) {
    soundOrderFilled();
    return;
  }
  if (next.openOrders.length > prev.openOrders.length) {
    soundOrderPlaced();
    return;
  }
  const prevCancelled = prev.orderHistory.filter(o => o.status === 'cancelled').length;
  const nextCancelled = next.orderHistory.filter(o => o.status === 'cancelled').length;
  if (nextCancelled > prevCancelled) soundOrderCancelled();
}

function dispatch(action: Parameters<typeof bookReducer>[1]) {
  const next = bookReducer(state, action);
  if (next === state) return;
  playBookTransitionSound(state, next);
  state = next;
  saveState(state);
  emit();
}

export function closeSimPosition(position: SimPosition) {
  if (position.qty <= 0) return;
  // 平仓 = 反向市价单。仓位里存的希腊字母是「单腿值 × 方向符号」，
  // 除以 sign 还原单腿原值交给 applyFill，由新单的反向 side 重新定号、相互抵消。
  const sign = position.side === 'long' ? 1 : -1;
  dispatch({
    t: 'place',
    a: {
      side: position.side === 'long' ? 'sell' : 'buy',
      type: 'market',
      symbol: position.symbol,
      qty: position.qty,
      price: position.markPrice,
      mark: position.markPrice,
      delta: position.delta / sign,
      gamma: position.gamma / sign,
      theta: position.theta / sign,
      vega: position.vega / sign,
    },
  });
}

export function useGlobalOptionBook() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const placeOrder = useCallback((a: PlaceArgs) => dispatch({ t: 'place', a }), []);
  const cancelOrder = useCallback((id: string) => dispatch({ t: 'cancel', id }), []);
  const editOrder = useCallback((id: string, price: number, qty: number) => dispatch({ t: 'edit', id, price, qty }), []);
  const updateMarks = useCallback((marks: Record<string, number>) => dispatch({ t: 'marks', marks }), []);
  const clearBook = useCallback(() => dispatch({ t: 'clear' }), []);
  const closePosition = useCallback((position: SimPosition) => closeSimPosition(position), []);

  return { ...snapshot, placeOrder, cancelOrder, editOrder, updateMarks, clearBook, closePosition };
}

export type GlobalOptionBook = ReturnType<typeof useGlobalOptionBook>;
