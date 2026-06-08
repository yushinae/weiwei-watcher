import { useCallback, useSyncExternalStore } from 'react';
import { bookReducer, type BookState, type PlaceArgs, type SimPosition } from './simBook';
import { get as apiGet, put as apiPut } from '../../api';

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

function dispatch(action: Parameters<typeof bookReducer>[1]) {
  const next = bookReducer(state, action);
  if (next === state) return;
  state = next;
  saveState(state);
  emit();
}

const inferOptionDelta = (position: SimPosition) => {
  const magnitude = Math.abs(position.delta || 0);
  if (position.symbol.endsWith('-P')) return -magnitude;
  if (position.symbol.endsWith('-C')) return magnitude;
  return position.delta;
};

export function closeSimPosition(position: SimPosition) {
  if (position.qty <= 0) return;
  dispatch({
    t: 'place',
    a: {
      side: position.side === 'long' ? 'sell' : 'buy',
      type: 'market',
      symbol: position.symbol,
      qty: position.qty,
      price: position.markPrice,
      mark: position.markPrice,
      delta: inferOptionDelta(position),
    },
  });
}

export function useGlobalOptionBook() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const placeOrder = useCallback((a: PlaceArgs) => dispatch({ t: 'place', a }), []);
  const cancelOrder = useCallback((id: string) => dispatch({ t: 'cancel', id }), []);
  const updateMarks = useCallback((marks: Record<string, number>) => dispatch({ t: 'marks', marks }), []);
  const clearBook = useCallback(() => dispatch({ t: 'clear' }), []);
  const closePosition = useCallback((position: SimPosition) => closeSimPosition(position), []);

  return { ...snapshot, placeOrder, cancelOrder, updateMarks, clearBook, closePosition };
}

export type GlobalOptionBook = ReturnType<typeof useGlobalOptionBook>;
