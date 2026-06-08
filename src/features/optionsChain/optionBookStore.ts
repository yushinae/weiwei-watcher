import { useCallback, useSyncExternalStore } from 'react';
import { bookReducer, type BookState, type PlaceArgs, type SimPosition } from './simBook';

const initialState: BookState = {
  positions: [],
  openOrders: [],
  orderHistory: [],
  fills: [],
};

let state: BookState = initialState;
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
