import { useCallback, useMemo, useReducer } from 'react';

export type CardStatus =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'empty'; title?: string; description?: string }
  | { type: 'error'; title?: string; description?: string }
  | { type: 'stale'; since?: number };

type State<T> = {
  status: CardStatus;
  data: T | null;
  error: unknown;
  lastUpdatedAt: number | null;
};

type Action<T> =
  | { type: 'loading' }
  | { type: 'ready'; data: T; at: number }
  | { type: 'empty'; at: number; title?: string; description?: string }
  | { type: 'error'; error: unknown; title?: string; description?: string }
  | { type: 'stale'; since?: number }
  | { type: 'reset' };

function reducer<T>(s: State<T>, a: Action<T>): State<T> {
  switch (a.type) {
    case 'loading':
      return { ...s, status: { type: 'loading' }, error: null };
    case 'ready':
      return { status: { type: 'ready' }, data: a.data, error: null, lastUpdatedAt: a.at };
    case 'empty':
      return { status: { type: 'empty', title: a.title, description: a.description }, data: null, error: null, lastUpdatedAt: a.at };
    case 'error':
      return { ...s, status: { type: 'error', title: a.title, description: a.description }, error: a.error };
    case 'stale':
      return { ...s, status: { type: 'stale', since: a.since } };
    case 'reset':
      return { status: { type: 'loading' }, data: null, error: null, lastUpdatedAt: null };
  }
}

/**
 * 轻量卡片状态机（不引入 xstate），用于统一 loading/empty/error/stale 展示。
 * 后续接 WS 时，业务层只需要触发 markStale / markReady 即可。
 */
export function useCardStateMachine<T>() {
  const [state, dispatch] = useReducer(reducer<T>, {
    status: { type: 'loading' },
    data: null,
    error: null,
    lastUpdatedAt: null,
  } as State<T>);

  const api = useMemo(() => {
    return {
      status: state.status,
      data: state.data,
      error: state.error,
      lastUpdatedAt: state.lastUpdatedAt,
      setLoading: () => dispatch({ type: 'loading' }),
      setReady: (data: T) => dispatch({ type: 'ready', data, at: Date.now() }),
      setEmpty: (args?: { title?: string; description?: string }) =>
        dispatch({ type: 'empty', at: Date.now(), title: args?.title, description: args?.description }),
      setError: (error: unknown, args?: { title?: string; description?: string }) =>
        dispatch({ type: 'error', error, title: args?.title, description: args?.description }),
      markStale: (since?: number) => dispatch({ type: 'stale', since }),
      reset: () => dispatch({ type: 'reset' }),
    };
  }, [state]);

  // convenience
  const retry = useCallback(() => api.reset(), [api]);

  return { ...api, retry };
}

